import express from "express";

export function createHealthRouter(): express.Router {
  const router = express.Router();
  router.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  return router;
}
