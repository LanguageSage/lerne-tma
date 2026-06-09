import io
import os
import uuid
import base64
import logging
import datetime
import urllib.request
from PIL import Image, ImageDraw, ImageFont
from fastapi import HTTPException
from api.models import TMA_Deck, TMA_Card, TMAMedia, TMAUser

logger = logging.getLogger(__name__)

class SharingService:
    @staticmethod
    def generate_unique_share_id(prefix=""):
        return f"{prefix}{uuid.uuid4().hex[:12]}"

    @staticmethod
    def save_screenshot(share_id, screenshot_b64):
        if "," in screenshot_b64:
            screenshot_b64 = screenshot_b64.split(",")[1]
        
        try:
            img_data = base64.b64decode(screenshot_b64)
            filename = f"preview_{share_id}.png"
            # Delete old preview if exists
            TMAMedia.delete().where(TMAMedia.filename == filename, TMAMedia.folder == 'previews').execute()
            TMAMedia.create(
                filename=filename,
                folder='previews',
                content=img_data
            )
            logger.info(f"Saved custom screenshot for share_id: {share_id}")
            return True
        except Exception as e:
            logger.error(f"Error saving screenshot: {e}")
            return False

    @staticmethod
    def get_preview_image(info, share_id):
        """Generates a beautiful premium preview image for a shared item."""
        width, height = 1200, 630
        # Gradient-like background
        img = Image.new('RGB', (width, height), color=(15, 23, 42)) # Slate 900
        draw = ImageDraw.Draw(img)
        
        # Colors based on type
        is_deck = info.get("type") == "deck"
        if is_deck:
            primary = (168, 85, 247)   # Purple 500
            secondary = (99, 102, 241) # Indigo 500
        else:
            primary = (236, 72, 153)   # Pink 500
            secondary = (168, 85, 247) # Purple 500

        # Draw blobs
        draw.ellipse([700, -100, 1300, 500], fill=primary)
        draw.ellipse([-100, 300, 500, 900], fill=secondary)

        # Dark overlay
        overlay = Image.new('RGBA', (width, height), (15, 23, 42, 180))
        img.paste(overlay, (0, 0), overlay)

        # Font loading
        font_large, font_medium, font_small = SharingService._load_fonts()

        # Draw a "Card" container
        card_margin = 100
        card_width = width - 2*card_margin
        card_height = height - 2*card_margin
        card_bg = Image.new('RGBA', (card_width, card_height), (255, 255, 255, 25))
        img.paste(card_bg, (card_margin, card_margin), card_bg)

        # Real Image Integration
        image_path = info.get("image_path")
        if image_path and image_path.startswith("images/"):
            SharingService._draw_card_image(img, image_path, width, height, card_width)

        # Drawing text
        SharingService._draw_preview_text(draw, info, width, height, card_margin, font_large, font_medium, font_small, is_deck, image_path)

        buf = io.BytesIO()
        img = img.convert('RGB')
        img.save(buf, format='JPEG', quality=85)
        buf.seek(0)
        return buf.getvalue()

    @staticmethod
    def _load_fonts():
        try:
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
                return ImageFont.load_default(), ImageFont.load_default(), ImageFont.load_default()
            
            return (
                ImageFont.truetype(FONT_PATH, 80),
                ImageFont.truetype(FONT_PATH, 45),
                ImageFont.truetype(FONT_PATH, 32)
            )
        except Exception as e:
            logger.error(f"Font loading error: {e}")
            return ImageFont.load_default(), ImageFont.load_default(), ImageFont.load_default()

    @staticmethod
    def _draw_card_image(img, image_path, width, height, card_width):
        try:
            filename = image_path.split("/")[-1]
            media = TMAMedia.get_or_none(TMAMedia.filename == filename, TMAMedia.folder == 'images')
            if media:
                card_img = Image.open(io.BytesIO(bytes(media.content)))
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

    @staticmethod
    def _draw_preview_text(draw, info, width, height, card_margin, font_large, font_medium, font_small, is_deck, image_path):
        def draw_text_centered(text, y, font, fill):
            if not text: return
            try:
                text_width = draw.textlength(text, font=font)
            except:
                try:
                    bbox = draw.textbbox((0, 0), text, font=font)
                    text_width = bbox[2] - bbox[0]
                except:
                    text_width = len(text) * 20
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
        
        y_start = height/2 - (len(lines)-1)*45
        if image_path:
            y_start = card_margin + 100
            
        for i, line in enumerate(lines[:3]):
            draw_text_centered(line, y_start + i*90, font_large, (255, 255, 255))

        # Footer info
        creator_text = f"Автор: {info.get('creator_name', 'Lerne User')}"
        draw_text_centered(creator_text, height - card_margin - 80, font_medium, (148, 163, 184))
        draw_text_centered("Lerne TMA — Учите языки эффективно", height - 50, font_small, (99, 102, 241))

    @staticmethod
    def import_item(share_id, user_id, resolution=None):
        from api.services.decks import ensure_inbox_deck, import_deck
        
        if share_id.startswith("d_"):
            source_deck = TMA_Deck.get_or_none(TMA_Deck.share_id == share_id)
            if not source_deck:
                raise HTTPException(status_code=404, detail="Shared deck not found")
            
            # Check if deck with same name exists for this user
            existing_deck = TMA_Deck.get_or_none(TMA_Deck.user_id == user_id, TMA_Deck.name == source_deck.name, TMA_Deck.is_deleted == False)
            if existing_deck and not resolution:
                return {
                    "status": "conflict",
                    "type": "deck",
                    "existing_id": existing_deck.id,
                    "name": source_deck.name
                }
            
            # Resolution handling
            if resolution == 'cancel':
                return {"status": "cancelled"}
            
            target_deck = None
            if resolution == 'replace' and existing_deck:
                # Delete existing cards (soft delete or hard?)
                TMA_Card.update(is_deleted=True).where(TMA_Card.deck == existing_deck).execute()
                # Copy metadata
                existing_deck.metadata = source_deck.metadata
                existing_deck.save()
                target_deck = existing_deck
            elif resolution == 'merge' and existing_deck:
                target_deck = existing_deck
            else:
                # Create new deck inside Inbox folder
                from api.services.folders import ensure_inbox_folder
                inbox_folder = ensure_inbox_folder(user_id)
                target_deck = TMA_Deck.create(
                    user_id=user_id,
                    name=source_deck.name,
                    level=source_deck.level,
                    topic=source_deck.topic,
                    folder_id=inbox_folder.id,
                    metadata=source_deck.metadata, # Copy deck metadata (resources)
                    created_at=datetime.datetime.now(),
                    updated_at=datetime.datetime.now()
                )
            
            source_cards = TMA_Card.select().where(
                (TMA_Card.deck == source_deck) & (TMA_Card.is_deleted == False)
            )
            
            creator_id = source_deck.user_id
            count = 0
            for card in source_cards:
                # If merging, check if card exists
                if resolution == 'merge' and target_deck:
                    exists = TMA_Card.select().where(
                        TMA_Card.deck == target_deck,
                        TMA_Card.front_text == card.front_text,
                        TMA_Card.back_text == card.back_text,
                        TMA_Card.is_deleted == False
                    ).exists()
                    if exists: continue

                TMA_Card.create(
                    deck=target_deck,
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
                    creator_id=card.creator_id or creator_id,
                    created_at=datetime.datetime.now(),
                    updated_at=datetime.datetime.now()
                )
                count += 1
            
            return {
                "status": "ok", 
                "type": "deck", 
                "cards_added": count, 
                "new_deck_id": target_deck.id, 
                "deck_name": target_deck.name,
                "merged": resolution == 'merge'
            }
            
        elif share_id.startswith("c_"):
            inbox = ensure_inbox_deck(user_id)
            source_card = TMA_Card.get_or_none(TMA_Card.share_id == share_id)
            if not source_card:
                raise HTTPException(status_code=404, detail="Shared card not found")
            
            # Check if card exists anywhere? The user said "if the card is not in inbox? let there be a window with choice"
            # So I should check all decks of the user.
            existing_card = (TMA_Card
                            .select(TMA_Card, TMA_Deck)
                            .join(TMA_Deck)
                            .where(
                                TMA_Deck.user_id == user_id,
                                TMA_Card.front_text == source_card.front_text,
                                TMA_Card.back_text == source_card.back_text,
                                TMA_Card.is_deleted == False
                            ).first())
            
            if existing_card and not resolution:
                return {
                    "status": "conflict",
                    "type": "card",
                    "existing_id": existing_card.id,
                    "existing_deck_name": existing_card.deck.name if existing_card.deck else "Unknown",
                    "front": source_card.front_text
                }
            
            if resolution == 'skip':
                return {"status": "skipped"}
            
            if resolution == 'replace' and existing_card:
                existing_card.is_deleted = True
                existing_card.save()

            source_creator = source_card.creator_id or (source_card.deck.user_id if source_card.deck else None)

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
                creator_id=source_creator,
                created_at=datetime.datetime.now(),
                updated_at=datetime.datetime.now()
            )
            return {"status": "ok", "type": "card", "new_id": new_card.id, "inbox_id": inbox.id}
        else:
            raise HTTPException(status_code=400, detail="Invalid share link format")
