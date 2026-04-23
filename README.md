# Gemini Chat Website

A chat website with an Express backend and a browser frontend that calls Google Gemini.

Features:
- Full-screen chat interface in dark mode.
- Upload text/code files and PDFs to include extracted text as context.
- Triple-backtick code blocks are rendered with a one-click Copy button.

## Prerequisites

- Node.js 20+
- A Google Gemini API key

## Local Run

1. Install dependencies:

   npm install

2. Create environment file:

   cp .env.example .env

3. Set `GEMINI_API_KEY` in `.env`.

4. Start:

   npm start

5. Open `http://localhost:3000`

## Docker Run

1. Build image:

   docker build -t gemini-chat-website .

2. Run container:

   docker run --rm -p 3000:3000 -e GEMINI_API_KEY=your_key_here gemini-chat-website

3. Open `http://localhost:3000`

## Environment Variables

- `GEMINI_API_KEY` (required)
- `GEMINI_MODEL` (optional, default: `gemini-2.5-flash`)
- `PORT` (optional, default: `3000`)
