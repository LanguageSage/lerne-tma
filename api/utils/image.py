import io
import logging
from PIL import Image

logger = logging.getLogger(__name__)

def optimize_image(image_content: bytes, max_size: int = 1024, quality: int = 80) -> tuple[bytes, str]:
    """
    Оптимизирует изображение: масштабирует до max_size и конвертирует в WebP.
    
    Returns:
        tuple: (optimized_content_bytes, mime_type)
    """
    try:
        # Открываем изображение из байтов
        img = Image.open(io.BytesIO(image_content))
        
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
        img.save(output, format="WEBP", quality=quality, method=6) # method 6 = best compression
        
        return output.getvalue(), "image/webp"
        
    except Exception as e:
        logger.error(f"Error optimizing image in TMA: {e}")
        # Если что-то пошло не так, возвращаем оригинал (безопасный режим)
        return image_content, "image/jpeg"
