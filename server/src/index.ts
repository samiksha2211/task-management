import "dotenv/config";
import cors from "cors";
import express from "express";
import { errorHandler, notFound } from "./middleware/error";
import router from "./routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", router);

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 4000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RailWork API listening on port ${PORT}`);
});
