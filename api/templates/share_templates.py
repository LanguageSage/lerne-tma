def get_share_html(title, description, preview_url, app_url, web_url=None, tg_scheme_url=None):
    if not web_url:
        web_url = app_url
    if not tg_scheme_url:
        tg_scheme_url = app_url

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
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
    <title>{title} — Lerne</title>
    <style>
        * {{
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-tap-highlight-color: transparent;
        }}
        body {{
            background: #090d16;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px 16px;
            background-image: 
                radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.18) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(168, 85, 247, 0.18) 0px, transparent 50%);
        }}
        .container {{
            width: 100%;
            max-width: 460px;
            background: rgba(15, 23, 42, 0.82);
            border: 1px solid rgba(255, 255, 255, 0.12);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 24px 20px;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px -10px rgba(99, 102, 241, 0.25);
        }}
        .preview-wrapper {{
            position: relative;
            width: 100%;
            margin-bottom: 18px;
            border-radius: 16px;
            overflow: hidden;
            border: 1px solid rgba(255, 255, 255, 0.14);
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
            background: #1e293b;
            aspect-ratio: 16 / 9;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        .preview-card {{
            width: 100%;
            height: 100%;
            display: block;
            object-fit: cover;
            transition: transform 0.3s ease;
        }}
        .preview-card:hover {{
            transform: scale(1.02);
        }}
        .badge {{
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 14px;
            border-radius: 20px;
            background: rgba(99, 102, 241, 0.22);
            border: 1px solid rgba(99, 102, 241, 0.4);
            color: #a5b4fc;
            font-size: 0.82rem;
            font-weight: 700;
            margin-bottom: 12px;
            letter-spacing: 0.02em;
        }}
        h1 {{
            font-size: 1.35rem;
            font-weight: 800;
            line-height: 1.3;
            margin-bottom: 8px;
            color: #ffffff;
            letter-spacing: -0.01em;
            word-break: break-word;
        }}
        .desc {{
            color: #94a3b8;
            font-size: 0.88rem;
            line-height: 1.5;
            margin-bottom: 22px;
            word-break: break-word;
        }}
        .actions-group {{
            display: flex;
            flex-direction: column;
            gap: 12px;
        }}
        .btn {{
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            width: 100%;
            padding: 14px 18px;
            border-radius: 16px;
            text-decoration: none;
            font-weight: 700;
            font-size: 0.96rem;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
            border: none;
            outline: none;
        }}
        .btn:active {{
            transform: scale(0.98);
        }}
        .btn-tg {{
            background: linear-gradient(135deg, #229ED9 0%, #0088cc 100%);
            color: #ffffff;
            box-shadow: 0 8px 22px rgba(34, 158, 217, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.2);
        }}
        .btn-tg:hover {{
            box-shadow: 0 12px 28px rgba(34, 158, 217, 0.55);
            filter: brightness(1.05);
        }}
        .btn-web {{
            background: rgba(255, 255, 255, 0.08);
            color: #f1f5f9;
            border: 1px solid rgba(255, 255, 255, 0.16);
            backdrop-filter: blur(8px);
        }}
        .btn-web:hover {{
            background: rgba(255, 255, 255, 0.14);
            color: #ffffff;
            border-color: rgba(255, 255, 255, 0.28);
        }}
        .icon {{
            width: 20px;
            height: 20px;
            flex-shrink: 0;
        }}
        .footer-note {{
            margin-top: 18px;
            font-size: 0.76rem;
            color: #64748b;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="preview-wrapper">
            <img src="{preview_url}" class="preview-card" alt="Preview" onerror="this.style.display='none'">
        </div>
        <div class="badge">
            <span>✨ Lerne App</span>
        </div>
        <h1>{title}</h1>
        <p class="desc">{description}</p>
        
        <div class="actions-group">
            <a href="{tg_scheme_url}" onclick="handleTelegramClick(event)" class="btn btn-tg">
                <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                </svg>
                🚀 Учить в Telegram
            </a>
            <a href="{web_url}" class="btn btn-web">
                <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                🌍 Учить в браузере (телефон / планшет / ПК)
            </a>
        </div>
        <p class="footer-note">Учите немецкий эффективно на любом устройстве</p>
    </div>

    <script>
        function handleTelegramClick(e) {{
            e.preventDefault();
            var tgScheme = "{tg_scheme_url}";
            var appUrl = "{app_url}";
            
            // 1. Попытка нативного открытия приложения Telegram
            window.location.href = tgScheme;
            
            // 2. Фоллбэк на веб-ссылку Telegram t.me через 600мс (если нативный протокол не обработался)
            setTimeout(function() {{
                window.location.href = appUrl;
            }}, 600);
        }}
    </script>
</body>
</html>"""


def get_share_error_html(error_title, error_desc, home_url="https://tma-amber.vercel.app"):
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>{error_title} — Lerne</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background: #090d16;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px 16px;
        }}
        .container {{
            width: 100%;
            max-width: 440px;
            background: rgba(15, 23, 42, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 24px;
            padding: 28px 24px;
            text-align: center;
        }}
        h1 {{ font-size: 1.3rem; margin-bottom: 10px; color: #f87171; }}
        p {{ color: #94a3b8; font-size: 0.9rem; margin-bottom: 20px; line-height: 1.5; }}
        .btn {{
            display: inline-block;
            width: 100%;
            padding: 14px 20px;
            border-radius: 16px;
            background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
            color: #ffffff;
            text-decoration: none;
            font-weight: 700;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>{error_title}</h1>
        <p>{error_desc}</p>
        <a href="{home_url}" class="btn">Перейти в Lerne App</a>
    </div>
</body>
</html>"""
