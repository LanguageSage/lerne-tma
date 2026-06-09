def get_share_html(title, description, preview_url, app_url):
    return f"""
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
            <a href="{app_url}" class="btn">Открыть Лерне Тма</a>
        </div>

        <script>
            // Auto-redirect to Telegram app after a short delay if in a browser
            // but not inside the Telegram WebApp itself
            setTimeout(() => {{
                const isTelegram = /Telegram/i.test(navigator.userAgent);
                if (isTelegram || window.innerWidth < 1024) {{
                    console.log("Attempting auto-redirect to:", "{app_url}");
                    window.location.href = "{app_url}";
                }}
            }}, 1000);
        </script>
    </body>
    </html>
    """
