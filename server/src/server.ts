import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import multer from "multer";
import {
  getChanges,
  applyChanges,
  savePhoto,
  getPhoto,
  photoExists,
  getPhotoIds,
} from "./db.ts";
import type { Household, Meter, Reading } from "./types.ts";

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(cors());
// Sync payloads carry many records; allow a generous JSON body limit.
app.use(express.json({ limit: "25mb" }));

// Photos are sent as multipart/form-data (recommended in the PRD for large images).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const nowIso = (): string => new Date().toISOString();

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", time: nowIso() });
});

// --- Sync -----------------------------------------------------------------

app.get("/sync/changes", (req: Request, res: Response) => {
  const since =
    typeof req.query["since"] === "string" ? req.query["since"].trim() : "";
  const { meters, readings, households } = getChanges(since || null);
  res.json({ serverTime: nowIso(), meters, readings, households });
});

app.post("/sync/changes", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    meters?: Partial<Meter>[];
    readings?: Partial<Reading>[];
    households?: Partial<Household>[];
  };
  const meters = Array.isArray(body.meters) ? body.meters : [];
  const readings = Array.isArray(body.readings) ? body.readings : [];
  const households = Array.isArray(body.households) ? body.households : [];
  const applied = applyChanges(meters, readings, households);
  res.json({ serverTime: nowIso(), applied });
});

// --- Photos ---------------------------------------------------------------

app.get("/photos/manifest", (_req: Request, res: Response) => {
  res.json({ ids: getPhotoIds() });
});

app.get("/photos/:id", (req: Request, res: Response) => {
  const id = req.params["id"];
  const photo = id ? getPhoto(id) : undefined;
  if (!photo) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.setHeader("Content-Type", photo.mimeType || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(photo.data);
});

app.post("/photos", upload.single("data"), (req: Request, res: Response) => {
  const { id, readingId, mimeType } = (req.body ?? {}) as {
    id?: string;
    readingId?: string;
    mimeType?: string;
  };
  if (!id) {
    res.status(400).json({ error: "missing_id" });
    return;
  }
  // Idempotent: an existing id is a no-op success.
  if (!photoExists(id)) {
    if (!req.file) {
      res.status(400).json({ error: "missing_file" });
      return;
    }
    savePhoto({
      id,
      readingId: readingId ?? "",
      mimeType: mimeType || req.file.mimetype,
      data: req.file.buffer,
      createdAt: nowIso(),
    });
  }
  res.json({ id });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`Meter Tracker sync server listening on port ${PORT}`);
});
