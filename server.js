const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 12,
    fileSize: 10 * 1024 * 1024
  }
});
const DEFAULT_CODING_SYSTEM_PROMPT = `You are a senior software engineering assistant.
Primary goal: help with coding tasks clearly and accurately.

Rules:
- Prefer complete, runnable solutions when the user asks for an entire application.
- Explain architecture and tradeoffs briefly, then focus on implementation details.
- If requirements are ambiguous, state assumptions explicitly.
- Keep answers practical, production-oriented, and secure by default.
- For bug fixes, identify root cause and provide corrected code.
- Respect uploaded file context as source of truth when relevant.
- Strict Two-File Limit: Put all backend code (Node.js, Express, Mongoose) in one single server.js file, and all frontend code in one single index.html file. Do not create separate folders or router files.
- Auto-Serve HTML: Include app.use(express.static(__dirname)); in the Express setup so the index.html file can be served locally without CORS errors.
- Zero CSS: Do not include any styling. Keep the HTML purely structural with basic inputs, buttons, and divs.
- Vanilla Frontend: Use only raw HTML and plain JavaScript. Use the native fetch() API for network requests. Do not use React, jQuery, or any external CDNs.
- Minimalist & Uncommented: Write the absolute minimum amount of code required to fulfill the assignment. Do not add any comments in the code.
`;

function normalizeModelName(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/^models\//, "");
}

function isModelUnavailableError(error) {
  const status = error && typeof error.status === "number" ? error.status : 0;
  const message = (error && error.message ? String(error.message) : "").toLowerCase();

  return (
    status === 404 ||
    message.includes("not found") ||
    message.includes("not supported for generatecontent")
  );
}

function looksLikeTextFile(file) {
  if (!file || typeof file.originalname !== "string") {
    return false;
  }

  const lowerName = file.originalname.toLowerCase();
  const textExtensions = [
    ".txt",
    ".md",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".csv",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".java",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".html",
    ".css",
    ".scss",
    ".sql",
    ".sh",
    ".env",
    ".toml",
    ".ini",
    ".c",
    ".cpp",
    ".h",
    ".hpp"
  ];

  return (
    (typeof file.mimetype === "string" && file.mimetype.startsWith("text/")) ||
    textExtensions.some((ext) => lowerName.endsWith(ext))
  );
}

async function parseUploadedFileToText(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new Error("Missing uploaded file buffer.");
  }

  if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
    const parsed = await pdfParse(file.buffer);
    return (parsed.text || "").trim();
  }

  if (looksLikeTextFile(file)) {
    return file.buffer.toString("utf8").trim();
  }

  throw new Error("Unsupported file type. Upload text/code files or PDFs.");
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/parse-files", upload.array("files"), async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];

    if (!files.length) {
      return res.status(400).json({ error: "No files uploaded." });
    }

    const parsedFiles = [];

    for (const file of files) {
      try {
        const text = await parseUploadedFileToText(file);
        parsedFiles.push({
          name: file.originalname,
          size: file.size,
          text: text.slice(0, 50000)
        });
      } catch (error) {
        parsedFiles.push({
          name: file.originalname,
          size: file.size,
          text: "",
          error: (error && error.message) || "Failed to parse file."
        });
      }
    }

    return res.json({ files: parsedFiles });
  } catch (error) {
    return res.status(500).json({
      error: (error && error.message) || "Failed to parse uploaded files."
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: modelName });
});

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Missing GEMINI_API_KEY. Add it to your environment before starting the server."
      });
    }

    const { message, history = [], systemPrompt = "", fileContext = "" } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    const chatHistory = Array.isArray(history)
      ? history
          .filter(
            (item) =>
              item &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string" &&
              item.content.trim()
          )
          .map((item) => ({
            role: item.role === "assistant" ? "model" : "user",
            parts: [{ text: item.content }]
          }))
      : [];

    const requestedModel = normalizeModelName(modelName);
    const candidateModels = [
      requestedModel,
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-pro"
    ].filter((value, index, list) => value && list.indexOf(value) === index);

    let reply = "";
    let lastError = null;
    const promptFromUser =
      typeof systemPrompt === "string" && systemPrompt.trim()
        ? systemPrompt.trim()
        : DEFAULT_CODING_SYSTEM_PROMPT;
    const normalizedFileContext =
      typeof fileContext === "string" ? fileContext.trim().slice(0, 120000) : "";
    const finalMessage = normalizedFileContext
      ? `${message}\n\nUploaded file context:\n${normalizedFileContext}`
      : message;

    for (const candidateModel of candidateModels) {
      try {
        const model = genAI.getGenerativeModel({
          model: candidateModel,
          systemInstruction: promptFromUser
        });

        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(finalMessage);
        reply = result.response.text();
        break;
      } catch (error) {
        lastError = error;
        if (!isModelUnavailableError(error)) {
          throw error;
        }
      }
    }

    if (!reply) {
      throw (
        lastError ||
        new Error(
          "No supported Gemini model was found. Set GEMINI_MODEL to a currently available model."
        )
      );
    }

    return res.json({ reply });
  } catch (error) {
    const status = error && typeof error.status === "number" ? error.status : 500;
    const message =
      (error && error.message) || "Unexpected error while contacting Gemini.";

    return res.status(status).json({ error: message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Gemini chat server running at http://localhost:${port}`);
});
