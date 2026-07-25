from fastapi import FastAPI

app = FastAPI()

@app.get("/api/health")
@app.get("/health")
def health():
    return {"status": "ok", "message": "Vercel Python active"}

@app.api_route("/api/{path:path}", methods=["GET", "POST"])
@app.api_route("/{path:path}", methods=["GET", "POST"])
def catch_all(path: str):
    return {"status": "ok", "path": path}

app = app
