import uuid
import logging
from fastapi import APIRouter, Depends, HTTPException, Body
from typing import Optional
from playhouse.shortcuts import model_to_dict

from api.models import TMAUser, TMA_Deck, TMA_Card
from api.dependencies.auth import get_user_id

router = APIRouter(tags=["share"])
logger = logging.getLogger(__name__)

def generate_unique_share_id(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:12]}"

@router.post("/share/generate/{type}/{item_id}")
def generate_share(type: str, item_id: int, data: dict = Body(None), user_id: int = Depends(get_user_id)):
    """Generates or retrieves a unique share_id for a deck or card."""
    prefix = "d_" if type == "deck" else "c_"
    
    if type == "deck":
        item = TMA_Deck.get_or_none((TMA_Deck.id == item_id) & (TMA_Deck.user_id == user_id))
    elif type == "card":
        item = TMA_Card.get_or_none(TMA_Card.id == item_id)
    else:
        raise HTTPException(status_code=400, detail="Invalid item type")
        
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
        
    if not item.share_id:
        item.share_id = f"{prefix}{uuid.uuid4().hex[:12]}"
        item.save()
    
    res_share_id = item.share_id

    # Handle Screenshot if provided
    if data and "screenshot" in data:
        screenshot_b64 = data["screenshot"]
        if "," in screenshot_b64:
            screenshot_b64 = screenshot_b64.split(",")[1]
        
        try:
            import base64
            img_data = base64.b64decode(screenshot_b64)
            from api.models import TMAMedia
            filename = f"preview_{res_share_id}.png"
            # Delete old preview if exists
            TMAMedia.delete().where(TMAMedia.filename == filename, TMAMedia.folder == 'previews').execute()
            TMAMedia.create(
                filename=filename,
                folder='previews',
                content=img_data
            )
            logger.info(f"Saved custom screenshot for share_id: {res_share_id}")
        except Exception as e:
            logger.error(f"Error saving screenshot: {e}")

    return {"status": "ok", "share_id": res_share_id}


@router.get("/share/info/{share_id}")
def get_share_info(share_id: str):
    """Gets public info about a shared item for preview."""
    if share_id.startswith("d_"):
        deck = TMA_Deck.get_or_none(TMA_Deck.share_id == share_id)
        if not deck:
            raise HTTPException(status_code=404, detail="Shared deck not found")
            
        creator = TMAUser.get_or_none(TMAUser.user_id == deck.user_id)
        return {
            "type": "deck",
            "id": deck.id,
            "name": deck.name,
            "level": deck.level,
            "topic": deck.topic,
            "creator_name": creator.username or creator.first_name if creator else "Unknown",
            "creator_avatar": creator.photo_url if creator else None
        }
    elif share_id.startswith("c_"):
        card = TMA_Card.get_or_none(TMA_Card.share_id == share_id)
        if not card:
            raise HTTPException(status_code=404, detail="Shared card not found")
            
        creator_id = card.creator_id or card.deck.user_id
        creator = TMAUser.get_or_none(TMAUser.user_id == creator_id)
        return {
            "type": "card",
            "id": card.id,
            "front_text": card.front_text,
            "back_text": card.back_text,
            "image_path": card.image_path,
            "creator_name": creator.username or creator.first_name if creator else "Unknown",
            "creator_avatar": creator.photo_url if creator else None
        }
    else:
        raise HTTPException(status_code=400, detail="Invalid share link format")

@router.post("/share/import")
def import_shared_item(
    payload: dict = Body(...), 
    user_id: int = Depends(get_user_id)
):
    """Imports a shared card into Inbox or a shared deck as a new standalone deck."""
    from api.services.decks import ensure_inbox_deck
    import datetime
    
    share_id = payload.get("share_id")
    if not share_id:
        raise HTTPException(status_code=400, detail="share_id is required")

    if share_id.startswith("d_"):
        source_deck = TMA_Deck.get_or_none(TMA_Deck.share_id == share_id)
        if not source_deck:
            raise HTTPException(status_code=404, detail="Shared deck not found")
        
        # Создаем новую колоду для пользователя (не во Входящие)
        new_deck = TMA_Deck.create(
            user_id=user_id,
            name=source_deck.name,
            level=source_deck.level,
            topic=source_deck.topic,
            created_at=datetime.datetime.now(),
            updated_at=datetime.datetime.now()
        )
        
        # Копируем все карточки колоды в новую колоду
        source_cards = TMA_Card.select().where(
            (TMA_Card.deck == source_deck) & (TMA_Card.is_deleted == False)
        )
        creator_id = source_deck.user_id
        count = 0
        for card in source_cards:
            TMA_Card.create(
                deck=new_deck,
                front_text=card.front_text,
                back_text=card.back_text,
                context=card.context,
                image_path=card.image_path,
                image_data=card.image_data,
                audio_path=card.audio_path,
                tags=card.tags,
                metadata=card.metadata,
                card_type=card.card_type,
                difficulty=card.difficulty,
                topics=card.topics,
                source=f"shared_deck:{source_deck.share_id}",
                creator_id=card.creator_id or creator_id
            )
            count += 1
            
        return {"status": "ok", "type": "deck", "cards_added": count, "new_deck_id": new_deck.id, "deck_name": new_deck.name}
        
    elif share_id.startswith("c_"):
        # Карточки кладём во «Входящие»
        inbox = ensure_inbox_deck(user_id)
        
        source_card = TMA_Card.get_or_none(TMA_Card.share_id == share_id)
        if not source_card:
            raise HTTPException(status_code=404, detail="Shared card not found")
        
        new_card = TMA_Card.create(
            deck=inbox,
            front_text=source_card.front_text,
            back_text=source_card.back_text,
            context=source_card.context,
            image_path=source_card.image_path,
            image_data=source_card.image_data,
            audio_path=source_card.audio_path,
            tags=source_card.tags,
            metadata=source_card.metadata,
            card_type=source_card.card_type,
            difficulty=source_card.difficulty,
            topics=source_card.topics,
            source=f"shared_card:{source_card.share_id}",
            creator_id=source_card.creator_id or source_card.deck.user_id
        )
        
        return {"status": "ok", "type": "card", "new_id": new_card.id, "inbox_id": inbox.id}
    else:
        raise HTTPException(status_code=400, detail="Invalid share link format")

from fastapi.responses import HTMLResponse, Response
import io
from PIL import Image, ImageDraw, ImageFont

@router.get("/share/v/{share_id}", response_class=HTMLResponse)
def view_shared_item(share_id: str):
    """Returns a page with OpenGraph tags for beautiful link preview in Telegram/Socials."""
    info = get_share_info(share_id)
    title = info.get("name") or info.get("front_text") or "Lerne TMA"
    description = f"Поделился: {info.get('creator_name', 'Пользователь Lerne')}"
    if info.get("type") == "deck":
        description += f" | Уровень: {info.get('level', '—')} | Тема: {info.get('topic', '—')}"
    else:
        description += " | Новая карточка для изучения"

    preview_url = f"https://tma-amber.vercel.app/api/preview/{share_id}.jpg?v=14"
    bot_url = f"https://t.me/LerneDeutsch287_bot?start={share_id}"

    html = f"""
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta property="og:site_name" content="Lerne TMA">
        <meta property="og:title" content="{title}">
        <meta property="og:description" content="{description}">
        <meta property="og:image" content="{preview_url}">
        <meta property="og:image:secure_url" content="{preview_url}">
        <meta property="og:image:type" content="image/jpeg">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:image" content="{preview_url}">
        <meta name="twitter:title" content="{title}">
        <meta name="twitter:description" content="{description}">
        <title>{title}</title>
        <style>
            body {{
                margin: 0;
                padding: 0;
                background: #0f172a;
                color: white;
                font-family: 'Inter', -apple-system, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                text-align: center;
            }}
            .container {{
                max-width: 600px;
                padding: 20px;
            }}
            .preview-card {{
                width: 100%;
                max-width: 500px;
                border-radius: 20px;
                box-shadow: 0 20px 50px rgba(0,0,0,0.5), 0 0 20px rgba(99, 102, 241, 0.2);
                margin-bottom: 30px;
                border: 1px solid rgba(255,255,255,0.1);
            }}
            h1 {{ font-size: 1.5rem; margin-bottom: 10px; }}
            p {{ color: #94a3b8; margin-bottom: 30px; }}
            .btn {{
                display: inline-block;
                background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
                color: white;
                padding: 16px 32px;
                border-radius: 14px;
                text-decoration: none;
                font-weight: bold;
                font-size: 1.1rem;
                transition: transform 0.2s;
                box-shadow: 0 10px 20px rgba(99, 102, 241, 0.3);
            }}
            .btn:active {{ transform: scale(0.95); }}
            .loader {{
                margin-top: 20px;
                font-size: 0.8rem;
                opacity: 0.5;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <img src="{preview_url}" class="preview-card" alt="Card Preview">
            <h1>{title}</h1>
            <p>{description}</p>
            <a href="{bot_url}" class="btn">Изучить в Telegram</a>
        </div>
    </body>
    </html>
    """
    return html



@router.get("/preview/{share_id}.jpg")
@router.get("/share/v/{share_id}/preview.png")
@router.get("/share/v/{share_id}/preview.jpg")
@router.get("/share/v/{share_id}/preview_v12.jpg")
def get_share_preview_image(share_id: str):
    """Returns a stored screenshot or generates a beautiful premium preview image."""
    from api.models import TMAMedia
    filename = f"preview_{share_id}.png"
    media = TMAMedia.get_or_none(TMAMedia.filename == filename, TMAMedia.folder == 'previews')
    
    headers = {
        "Cache-Control": "public, max-age=31536000",
        "Access-Control-Allow-Origin": "*"
    }
    
    if media:
        return Response(content=bytes(media.content), media_type="image/jpeg", headers=headers)

    info = get_share_info(share_id)
    
    width, height = 1200, 630
    # Gradient-like background
    img = Image.new('RGB', (width, height), color=(15, 23, 42)) # Slate 900
    draw = ImageDraw.Draw(img)
    
    # Add some "blobs" for visual interest
    is_deck = info.get("type") == "deck"
    
    # Colors based on type
    if is_deck:
        primary = (168, 85, 247)   # Purple 500
        secondary = (99, 102, 241) # Indigo 500
    else:
        primary = (236, 72, 153)   # Pink 500
        secondary = (168, 85, 247) # Purple 500

    # Draw blobs
    draw.ellipse([700, -100, 1300, 500], fill=primary)
    draw.ellipse([-100, 300, 500, 900], fill=secondary)

    # Blur effect (simulated by drawing a semi-transparent overlay)
    overlay = Image.new('RGBA', (width, height), (15, 23, 42, 180)) # Dark overlay
    img.paste(overlay, (0, 0), overlay)

    try:
        import os, urllib.request
        FONT_PATH = "api/fonts/NotoSans-Bold.ttf"
        
        if not os.path.exists(FONT_PATH):
            FONT_PATH = "/tmp/Montserrat-Bold.ttf"
            if not os.path.exists(FONT_PATH):
                try:
                    urllib.request.urlretrieve(
                        "https://github.com/googlefonts/montserrat/raw/main/fonts/ttf/Montserrat-Bold.ttf",
                        FONT_PATH
                    )
                except:
                    FONT_PATH = None
        
        if not FONT_PATH or not os.path.exists(FONT_PATH):
             font_large = ImageFont.load_default()
             font_medium = ImageFont.load_default()
             font_small = ImageFont.load_default()
        else:
            font_large = ImageFont.truetype(FONT_PATH, 80)
            font_medium = ImageFont.truetype(FONT_PATH, 45)
            font_small = ImageFont.truetype(FONT_PATH, 32)
    except Exception as e:
        logger.error(f"Font loading error: {e}")
        font_large = ImageFont.load_default()
        font_medium = ImageFont.load_default()
        font_small = ImageFont.load_default()

    # Draw a "Card" container
    card_margin = 100
    card_width = width - 2*card_margin
    card_height = height - 2*card_margin
    
    # Draw card background
    card_bg = Image.new('RGBA', (card_width, card_height), (255, 255, 255, 25))
    img.paste(card_bg, (card_margin, card_margin), card_bg)

    # --- REAL IMAGE INTEGRATION ---
    image_path = info.get("image_path")
    if image_path and image_path.startswith("images/"):
        try:
            from api.models import TMAMedia
            filename = image_path.split("/")[-1]
            media = TMAMedia.get_or_none(TMAMedia.filename == filename, TMAMedia.folder == 'images')
            if media:
                card_img = Image.open(io.BytesIO(bytes(media.content)))
                # Resize and paste as a "preview" inside the card
                img_w, img_h = card_img.size
                aspect = img_w / img_h
                new_h = 250
                new_w = int(new_h * aspect)
                if new_w > card_width - 100:
                    new_w = card_width - 100
                    new_h = int(new_w / aspect)
                
                card_img = card_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
                img.paste(card_img, (int(width/2 - new_w/2), int(height/2 - new_h/2 + 20)))
        except Exception as e:
            logger.error(f"Error drawing real image in share preview: {e}")

    # Manual text centering helper (Pillow 10+ compatible)
    def draw_text_centered(text, y, font, fill):
        if not text: return
        # Calculate width
        try:
            # textlength is the most modern way in Pillow
            text_width = draw.textlength(text, font=font)
        except:
            try:
                # fallback for older Pillow
                bbox = draw.textbbox((0, 0), text, font=font)
                text_width = bbox[2] - bbox[0]
            except:
                text_width = len(text) * 20 # last resort
            
        draw.text(((width - text_width) / 2, y), text, fill=fill, font=font)

    # Type Badge
    type_text = "КОЛОДА" if is_deck else "КАРТОЧКА"
    draw_text_centered(type_text, card_margin + 30, font_small, (165, 180, 252))

    # Main Text
    main_text = info.get("name") or info.get("front_text") or "Lerne TMA"
    words = main_text.split()
    lines = []
    current_line = []
    for word in words:
        if len(" ".join(current_line + [word])) < 22:
            current_line.append(word)
        else:
            lines.append(" ".join(current_line))
            current_line = [word]
    lines.append(" ".join(current_line))
    
    # Adjust position if image is present
    y_start = height/2 - (len(lines)-1)*45
    if image_path:
        y_start = card_margin + 100 # Move text higher
        
    for i, line in enumerate(lines[:3]):
        draw_text_centered(line, y_start + i*90, font_large, (255, 255, 255))

    # Footer info
    creator_text = f"Автор: {info.get('creator_name', 'Lerne User')}"
    draw_text_centered(creator_text, height - card_margin - 80, font_medium, (148, 163, 184))
    
    # App Branding
    draw_text_centered("Lerne TMA — Учите языки эффективно", height - 50, font_small, (99, 102, 241))

    buf = io.BytesIO()
    img = img.convert('RGB')
    img.save(buf, format='JPEG', quality=85)
    buf.seek(0)
    return Response(content=buf.getvalue(), media_type="image/jpeg")




