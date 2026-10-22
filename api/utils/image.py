from api.utils.storage_keys import storage_object_path
import io
import logging
from api.local_runtime import is_local
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

def optimize_image(image_content: bytes, max_size: int = 1024, quality: int = 80) -> tuple[bytes, str]:
    """
    Оптимизирует изображение: делает автоповорот EXIF, масштабирует до max_size и конвертирует в WebP.
    
    Returns:
        tuple: (optimized_content_bytes, mime_type)
    """
    try:
        # Открываем изображение из байтов и учитываем EXIF-ориентацию
        img = Image.open(io.BytesIO(image_content))
        img = ImageOps.exif_transpose(img)
        
        # Конвертируем в RGBA/RGB (важно для WebP и удаления метаданных)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGBA")
        else:
            img = img.convert("RGB")
            
        # Масштабирование с сохранением пропорций
        w, h = img.size
        if w > max_size or h > max_size:
            ratio = min(max_size / w, max_size / h)
            new_w, new_h = int(w * ratio), int(h * ratio)
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
            logger.info(f"TMA Image Optimized: {w}x{h} -> {new_w}x{new_h}")
        
        # Сохранение в WebP в буфер памяти
        output = io.BytesIO()
        img.save(output, format="WEBP", quality=quality, method=4)  # method 4 = fast, good quality
        
        return output.getvalue(), "image/webp"
        
    except Exception as e:
        logger.error(f"Error optimizing image in TMA: {e}")
        # Если что-то пошло не так, возвращаем оригинал (безопасный режим)
        return image_content, "image/jpeg"


def upload_image_to_supabase(image_bytes: bytes, filename: str, content_type: str = "image/webp") -> str | None:
    """
    Загружает изображение напрямую в Supabase Storage bucket 'images'.
    
    Returns:
        Публичный URL или None в случае ошибки.
    """
    if is_local():
        return None
    import os
    import requests
    
    project_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    api_key = os.environ.get("SUPABASE_KEY", "")
    if not project_url or not api_key:
        logger.warning("Supabase URL or Key not configured for image storage upload.")
        return None
        
    bucket = "images"
    upload_url = f"{project_url}/storage/v1/object/{bucket}/{storage_object_path(filename)}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "x-upsert": "true",
        "Content-Type": content_type
    }
    
    try:
        resp = requests.post(upload_url, headers=headers, data=image_bytes, timeout=15)
        if resp.status_code in (200, 201):
            return f"{project_url}/storage/v1/object/public/{bucket}/{storage_object_path(filename)}"
        else:
            logger.error(f"Supabase Image Upload Error ({resp.status_code}): {resp.text[:120]}")
            return None
    except Exception as e:
        logger.error(f"Supabase Image Upload Exception: {e}")
        return None

