import express from "express";
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

app.get("/config.js", (_req, res) => {
  const api = process.env.API_URL || "http://localhost:4000";
  res.type("application/javascript").send(`window.API_URL=${JSON.stringify(api)};`);
});

app.listen(PORT, () => console.log(`WEB on :${PORT}`));
