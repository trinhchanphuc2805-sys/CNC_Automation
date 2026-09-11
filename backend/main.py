from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from routers import cnc, com, keypad, testcase, webcam


app = FastAPI(title="CNC Control API")
app.mount("/pictures", StaticFiles(directory=Path(__file__).resolve().parents[1] / "pictures", check_dir=False), name="pictures")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(com.router)
app.include_router(keypad.router)
app.include_router(cnc.router)
app.include_router(webcam.router)
app.include_router(testcase.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)