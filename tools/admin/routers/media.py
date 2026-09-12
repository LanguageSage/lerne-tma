"""Admin media, image management, and voice-preview router."""
import io
import logging
import os
import time
import uuid
import zipfile
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse
from peewee import fn
from pydantic import BaseModel

from api import models

logger = logging.getLogger(__name__)
router = APIRouter()

VOICE_SAMPLE_PHRASES = {
    "de": "Hallo! Ich lerne Deutsch mit der Lerne App. Wie geht es dir heute?",
    "en": "Hello! I am learning languages with the Lerne App. How are you today?",
    "nb": "Hei! Jeg lærer språk med Lerne App. Hvordan har du det i dag?",
    "no": "Hei! Jeg lærer språk med Lerne App. Hvordan har du det i dag?",
    "uk": "Привіт! Я вивчаю іноземні мови разом з додатком Lerne. Як твої справи?",
    "ru": "Привет! Я изучаю иностранные языки вместе с приложением Lerne.",
}

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# In-memory cache for media catalog to make filtering/searching instantaneous
_catalog_cache = {"timestamp": 0, "data": None}


def _get_images_catalog(force_refresh: bool = False):
    """Builds an index of all images in TMAMedia with their orphan/active status."""
    now = time.time()
    if not force_refresh and _catalog_cache["data"] and (now - _catalog_cache["timestamp"] < 30):
        return _catalog_cache["data"]

    try:
        # Collect referenced filenames from TMA_Card and library Card
        tma_paths = set(
            os.path.basename(p[0])
            for p in models.TMA_Card.select(models.TMA_Card.image_path)
            .where((models.TMA_Card.image_path.is_null(False)) & (models.TMA_Card.image_path != ""))
            .distinct()
            .tuples()
            if p[0]
        )

        card_paths = set(
            os.path.basename(p[0])
            for p in models.Card.select(models.Card.image_path)
            .where((models.Card.image_path.is_null(False)) & (models.Card.image_path != ""))
            .distinct()
            .tuples()
            if p[0]
        )

        active_filenames = tma_paths | card_paths

        # Fetch all images from TMAMedia without loading full binary blobs into memory
        media_rows = list(
            models.TMAMedia.select(
                models.TMAMedia.filename,
                fn.LENGTH(models.TMAMedia.content).alias("length")
            )
            .where(models.TMAMedia.folder == "images")
            .tuples()
        )

        items = []
        total_bytes = 0
        orphaned_bytes = 0
        active_bytes = 0
        orphaned_count = 0
        active_count = 0
        non_webp_count = 0
        non_webp_bytes = 0

        for filename, length in media_rows:
            size = int(length or 0)
            total_bytes += size
            is_orphaned = filename not in active_filenames
            is_webp = filename.lower().endswith(".webp")
            ext = os.path.splitext(filename)[1].lower().replace(".", "")
            if not is_webp:
                non_webp_count += 1
                non_webp_bytes += size

            if is_orphaned:
                orphaned_count += 1
                orphaned_bytes += size
            else:
                active_count += 1
                active_bytes += size

            items.append({
                "filename": filename,
                "size_bytes": size,
                "is_orphaned": is_orphaned,
                "is_webp": is_webp,
                "format": ext.upper() if ext else "UNKNOWN",
                "url": f"/api/media/images/{filename}"
            })

        # Sort: non_webp first when converting, else orphaned first, then alphabetical
        items.sort(key=lambda x: (x["is_webp"], not x["is_orphaned"], x["filename"]))

        result = {
            "stats": {
                "total_images": len(items),
                "total_size_bytes": total_bytes,
                "orphaned_count": orphaned_count,
                "orphaned_size_bytes": orphaned_bytes,
                "active_count": active_count,
                "active_size_bytes": active_bytes,
                "non_webp_count": non_webp_count,
                "non_webp_size_bytes": non_webp_bytes,
            },
            "items": items,
            "active_filenames": active_filenames
        }
        _catalog_cache["timestamp"] = now
        _catalog_cache["data"] = result
        return result
    except Exception as e:
        logger.error(f"Error computing images catalog: {e}", exc_info=True)
        return {
            "stats": {
                "total_images": 0, "total_size_bytes": 0,
                "orphaned_count": 0, "orphaned_size_bytes": 0,
                "active_count": 0, "active_size_bytes": 0,
                "non_webp_count": 0, "non_webp_size_bytes": 0,
            },
            "items": [],
            "active_filenames": set()
        }


# ─── Image Manager Endpoints ──────────────────────────────────────────────────

@router.get("/api/admin/media/stats")
def get_media_stats():
    """Returns overview counts and sizes for images."""
    catalog = _get_images_catalog()
    return catalog["stats"]


@router.get("/api/admin/media/images")
def list_media_images(
    filter: str = Query("all"),  # 'all' | 'orphaned' | 'active' | 'non_webp'
    q: Optional[str] = Query(default=None),
    page: int = Query(1, ge=1),
    limit: int = Query(60, ge=1, le=500),
    refresh: bool = Query(False)
):
    """Lists images with search, filter (orphaned/active/non_webp) and pagination."""
    catalog = _get_images_catalog(force_refresh=refresh)
    filtered = catalog["items"]

    if filter == "orphaned":
        filtered = [x for x in filtered if x["is_orphaned"]]
    elif filter == "active":
        filtered = [x for x in filtered if not x["is_orphaned"]]
    elif filter == "non_webp":
        filtered = [x for x in filtered if not x["is_webp"]]

    if isinstance(q, str) and q.strip():
        query = q.strip().lower()
        filtered = [x for x in filtered if query in x["filename"].lower()]

    total = len(filtered)
    pages = max(1, (total + limit - 1) // limit)
    offset = (page - 1) * limit
    page_items = filtered[offset:offset + limit]

    return {
        "stats": catalog["stats"],
        "items": page_items,
        "total": total,
        "page": page,
        "pages": pages,
        "limit": limit
    }


@router.get("/api/admin/media/usage/{filename:path}")
def get_image_usage(filename: str):
    """Finds which cards and decks use the specified image."""
    clean_name = os.path.basename(filename)
    try:
        cards = list(
            models.TMA_Card.select(
                models.TMA_Card.id,
                models.TMA_Card.front_text,
                models.TMA_Card.deck.alias("deck_id"),
                models.TMA_Deck.name.alias("deck_name")
            )
            .join(models.TMA_Deck, on=(models.TMA_Card.deck_id == models.TMA_Deck.id))
            .where(
                (models.TMA_Card.image_path.contains(clean_name)) &
                (models.TMA_Card.is_deleted == False)
            )
            .limit(10)
            .dicts()
        )

        lib_cards = list(
            models.Card.select(
                models.Card.id,
                models.Card.front_text,
                models.Card.deck.alias("deck_id"),
                models.Deck.name.alias("deck_name")
            )
            .join(models.Deck, on=(models.Card.deck_id == models.Deck.id))
            .where(
                (models.Card.image_path.contains(clean_name)) &
                (models.Card.is_deleted == False)
            )
            .limit(10)
            .dicts()
        )

        all_usages = []
        for c in cards:
            d_id = c.get("deck_id") or c.get("deck")
            all_usages.append({
                "card_id": c["id"],
                "front": (c["front_text"] or "")[:60],
                "deck_id": d_id,
                "deck_name": c.get("deck_name") or f"Колода #{d_id}",
                "source": "user"
            })
        for c in lib_cards:
            d_id = c.get("deck_id") or c.get("deck")
            all_usages.append({
                "card_id": c["id"],
                "front": (c["front_text"] or "")[:60],
                "deck_id": d_id,
                "deck_name": c.get("deck_name") or f"Библиотека #{d_id}",
                "source": "library"
            })

        return {
            "filename": clean_name,
            "is_orphaned": len(all_usages) == 0,
            "usages": all_usages
        }
    except Exception as e:
        logger.error(f"Error checking image usage: {e}", exc_info=True)
        return {"filename": clean_name, "is_orphaned": True, "usages": []}


@router.get("/api/admin/media/download/{filename:path}")
def download_single_image(filename: str):
    """Directly downloads an image file from TMAMedia."""
    clean_name = os.path.basename(filename)
    media = models.TMAMedia.get_or_none(
        (models.TMAMedia.filename == clean_name) &
        (models.TMAMedia.folder == "images")
    )
    if not media or not media.content:
        raise HTTPException(status_code=404, detail="Image not found in database")

    content = bytes(media.content)
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{clean_name}"'}
    )


class DownloadZipRequest(BaseModel):
    filenames: Optional[List[str]] = None
    orphaned_only: bool = True


@router.post("/api/admin/media/download-zip")
def download_images_zip(req: Optional[DownloadZipRequest] = None):
    """Packages images into a downloadable ZIP archive."""
    catalog = _get_images_catalog(force_refresh=True)
    orphaned_set = set(item["filename"] for item in catalog["items"] if item["is_orphaned"])

    if req and req.filenames and len(req.filenames) > 0:
        target_filenames = [os.path.basename(f) for f in req.filenames]
    elif req and not req.orphaned_only:
        target_filenames = [item["filename"] for item in catalog["items"]]
    else:
        # Default: download all orphaned images
        target_filenames = list(orphaned_set)

    if not target_filenames:
        raise HTTPException(status_code=400, detail="Нет картинок для выгрузки в архив")

    zip_buffer = io.BytesIO()
    added_count = 0

    # Fetch in chunks of 100 to keep DB connection healthy
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for i in range(0, len(target_filenames), 100):
            chunk = target_filenames[i:i + 100]
            media_records = list(
                models.TMAMedia.select(models.TMAMedia.filename, models.TMAMedia.content)
                .where(
                    (models.TMAMedia.filename << chunk) &
                    (models.TMAMedia.folder == "images")
                )
            )
            for m in media_records:
                if m.content:
                    zf.writestr(m.filename, bytes(m.content))
                    added_count += 1

    if added_count == 0:
        raise HTTPException(status_code=404, detail="Указанные файлы не найдены в базе данных")

    zip_buffer.seek(0)
    filename = "orphaned_images_backup.zip" if (not req or not req.filenames) else "selected_images.zip"
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


class CleanupRequest(BaseModel):
    filenames: Optional[List[str]] = None


@router.post("/api/admin/media/cleanup-orphaned")
def cleanup_orphaned_images(req: Optional[CleanupRequest] = None):
    """Safely cleans up orphaned images from TMAMedia.

    Guarantees active images are NEVER deleted by verifying against the active catalog.
    """
    catalog = _get_images_catalog(force_refresh=True)
    orphaned_set = set(item["filename"] for item in catalog["items"] if item["is_orphaned"])

    if req and req.filenames and len(req.filenames) > 0:
        target_filenames = [os.path.basename(f) for f in req.filenames if os.path.basename(f) in orphaned_set]
    else:
        target_filenames = list(orphaned_set)

    if not target_filenames:
        return {"status": "success", "deleted_count": 0, "freed_bytes": 0}

    deleted_count = 0
    freed_bytes = 0
    size_map = {item["filename"]: item["size_bytes"] for item in catalog["items"]}

    for i in range(0, len(target_filenames), 150):
        chunk = target_filenames[i:i + 150]
        count = models.TMAMedia.delete().where(
            (models.TMAMedia.filename << chunk) &
            (models.TMAMedia.folder == "images")
        ).execute()
        deleted_count += count
        for f in chunk:
            freed_bytes += size_map.get(f, 0)

    # Invalidate cache so UI immediately sees updated stats
    _catalog_cache["data"] = None
    logger.info(f"Admin cleaned up {deleted_count} orphaned images ({freed_bytes} bytes freed)")

    return {
        "status": "success",
        "deleted_count": deleted_count,
        "freed_bytes": freed_bytes
    }


class ConvertWebpRequest(BaseModel):
    filenames: Optional[List[str]] = None


@router.post("/api/admin/media/convert-to-webp")
def convert_images_to_webp(req: Optional[ConvertWebpRequest] = None):
    """
    Converts images from PNG/JPG/JPEG to optimized WebP.
    Updates TMAMedia records and replaces references in TMA_Card and Card image_path.
    """
    import datetime
    from api.utils.image import optimize_image

    target_filenames = None
    if req and req.filenames and len(req.filenames) > 0:
        target_filenames = [os.path.basename(f) for f in req.filenames]

    query = models.TMAMedia.select().where(models.TMAMedia.folder == "images")
    if target_filenames:
        query = query.where(models.TMAMedia.filename << target_filenames)
    else:
        # Default: all non-webp images
        query = query.where(~models.TMAMedia.filename.endswith(".webp"))

    media_items = list(query)
    if not media_items:
        return {
            "status": "success",
            "converted_count": 0,
            "original_bytes": 0,
            "new_bytes": 0,
            "saved_bytes": 0,
            "message": "Нет картинок, требующих конвертации в WebP"
        }

    converted_count = 0
    original_bytes = 0
    new_bytes = 0
    errors = []
    now = datetime.datetime.now()

    for m in media_items:
        old_filename = m.filename
        if old_filename.lower().endswith(".webp") and not target_filenames:
            continue

        raw_content = bytes(m.content) if m.content else b""
        if not raw_content:
            continue

        if raw_content.startswith(b"\x28\xb5\x2f\xfd"):
            try:
                import zstandard as zstd
                dctx = zstd.ZstdDecompressor()
                raw_content = dctx.decompress(raw_content, max_output_size=25 * 1024 * 1024)
            except Exception as ze:
                logger.warning(f"Failed to decompress zstd image {old_filename}: {ze}")

        old_size = len(raw_content)
        original_bytes += old_size

        try:
            webp_bytes, mime = optimize_image(raw_content, max_size=1200, quality=80)
            opt_size = len(webp_bytes)
            new_bytes += opt_size

            name_base = os.path.splitext(old_filename)[0]
            new_filename = f"{name_base}.webp"

            if new_filename != old_filename:
                collision = models.TMAMedia.get_or_none(
                    (models.TMAMedia.filename == new_filename) &
                    (models.TMAMedia.folder == "images")
                )
                if collision:
                    new_filename = f"{name_base}_{uuid.uuid4().hex[:4]}.webp"

            with models.tma_db.atomic():
                if new_filename != old_filename:
                    # Create or update new TMAMedia record
                    models.TMAMedia.create(
                        filename=new_filename,
                        folder="images",
                        content=webp_bytes
                    )
                    # Delete old TMAMedia record
                    models.TMAMedia.delete().where(
                        (models.TMAMedia.filename == old_filename) &
                        (models.TMAMedia.folder == "images")
                    ).execute()

                    # Update TMA_Card image_path
                    cards_to_update = list(
                        models.TMA_Card.select(models.TMA_Card.id, models.TMA_Card.image_path)
                        .where(models.TMA_Card.image_path.contains(old_filename))
                    )
                    for c in cards_to_update:
                        new_path = c.image_path.replace(old_filename, new_filename)
                        models.TMA_Card.update(
                            image_path=new_path,
                            updated_at=now
                        ).where(models.TMA_Card.id == c.id).execute()

                    # Update Card (library) image_path
                    lib_cards_to_update = list(
                        models.Card.select(models.Card.id, models.Card.image_path)
                        .where(models.Card.image_path.contains(old_filename))
                    )
                    for lc in lib_cards_to_update:
                        new_lib_path = lc.image_path.replace(old_filename, new_filename)
                        models.Card.update(
                            image_path=new_lib_path,
                            updated_at=now
                        ).where(models.Card.id == lc.id).execute()
                else:
                    # Same filename (already .webp), just re-optimized
                    models.TMAMedia.update(
                        content=webp_bytes
                    ).where(
                        (models.TMAMedia.filename == old_filename) &
                        (models.TMAMedia.folder == "images")
                    ).execute()

            converted_count += 1

        except Exception as e:
            logger.error(f"Error converting image {old_filename} to WebP: {e}", exc_info=True)
            errors.append(f"{old_filename}: {str(e)}")

    # Invalidate cache so UI immediately sees updated stats
    _catalog_cache["data"] = None

    saved_bytes = max(0, original_bytes - new_bytes)
    logger.info(f"Admin converted {converted_count} images to WebP. Saved {saved_bytes} bytes.")

    return {
        "status": "success",
        "converted_count": converted_count,
        "original_bytes": original_bytes,
        "new_bytes": new_bytes,
        "saved_bytes": saved_bytes,
        "errors": errors
    }


# ─── Standard Media Serving ───────────────────────────────────────────────────

@router.get("/api/media/images/{filename:path}")
def get_admin_image(filename: str):
    """Serves image files from TMAMedia for admin preview."""
    clean_name = os.path.basename(filename)
    media = models.TMAMedia.get_or_none(
        (models.TMAMedia.filename == clean_name) &
        (models.TMAMedia.folder == "images")
    )
    if not media or not media.content:
        raise HTTPException(status_code=404, detail="Image file not found")

    content = bytes(media.content)
    if content.startswith(b"\x28\xb5\x2f\xfd"):
        try:
            import zstandard as zstd
            dctx = zstd.ZstdDecompressor()
            content = dctx.decompress(content, max_output_size=25 * 1024 * 1024)
        except Exception as ze:
            logger.warning(f"Failed to decompress zstd image {clean_name}: {ze}")

    if content.startswith(b"\xff\xd8\xff"):
        media_type = "image/jpeg"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        media_type = "image/png"
    elif content.startswith(b"RIFF") and b"WEBP" in content[:16]:
        media_type = "image/webp"
    elif content.startswith(b"GIF8"):
        media_type = "image/gif"
    else:
        ext = clean_name.split(".")[-1].lower()
        media_type = f"image/{ext}" if ext != "jpg" else "image/jpeg"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=604800"}
    )


@router.get("/api/admin/voice-preview")
async def get_voice_preview(
    voice: str = Query("de-DE-KatjaNeural"),
    text: str = Query(None),
    rate: str = Query("+0%")
):
    """Generates on-the-fly voice preview audio for the chosen TTS voice and speed rate."""
    from api.utils.audio import SUPPORTED_VOICES, _prepare_tts_text

    clean_voice = voice.strip()
    clean_voice = SUPPORTED_VOICES.get(clean_voice, clean_voice)
    if not clean_voice or clean_voice.lower() in ("none", "off", "no", "disabled", ""):
        clean_voice = "de-DE-KatjaNeural"

    clean_rate = (rate or "+0%").strip()
    if not clean_rate.startswith(("+", "-")):
        clean_rate = f"+{clean_rate}"
    if not clean_rate.endswith("%"):
        clean_rate = f"{clean_rate}%"

    if not text or not text.strip():
        prefix = clean_voice[:2].lower()
        phrase = VOICE_SAMPLE_PHRASES.get(prefix, "Hallo! Ich lerne Sprachen mit der Lerne App.")
    else:
        phrase = _prepare_tts_text(text) or text.strip()

    try:
        import edge_tts
        communicate = edge_tts.Communicate(phrase, clean_voice, rate=clean_rate)
        audio_chunks = []
        async for event in communicate.stream():
            if event["type"] == "audio":
                audio_chunks.append(event["data"])

        audio_bytes = b"".join(audio_chunks)
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="Failed to synthesize voice preview")

        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "no-cache",
                "Content-Disposition": f'inline; filename="preview_{clean_voice}.mp3"'
            }
        )
    except Exception as e:
        logger.error(f"Voice preview error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Voice preview error: {str(e)}")


@router.get("/api/media/audio/{filename:path}")
def get_admin_audio(filename: str):
    """Serves audio files from TMAMedia or pending audio cache for admin preview."""
    clean_name = os.path.basename(filename)
    media = models.TMAMedia.get_or_none(
        (models.TMAMedia.filename == clean_name) &
        (models.TMAMedia.folder == "audio")
    )
    if media and media.content:
        return Response(
            content=bytes(media.content),
            media_type="audio/mpeg",
            headers={"Cache-Control": "public, max-age=604800"}
        )

    local_path = os.path.join(_PROJECT_ROOT, "user_files", "pending_audio", clean_name)
    if os.path.exists(local_path):
        return FileResponse(local_path, media_type="audio/mpeg")

    raise HTTPException(status_code=404, detail="Audio file not found")
