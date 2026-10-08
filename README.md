# Qwen Chat

A local, ChatGPT-style web chatbot powered by Qwen 2.5 3B through Ollama. Conversations are saved in this browser; chat messages are sent only to the local app and Ollama server.

## Requirements

- Node.js 18 or newer
- [Ollama](https://ollama.com/download)

## Start

1. Open PowerShell in this folder and download the model:

   ```powershell
   ollama pull qwen2.5:3b
   ```

2. Start Ollama if it is not already running.
3. Start the app:

   ```powershell
   npm start
   ```

4. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

The server uses `qwen2.5:3b` and Ollama at `http://127.0.0.1:11434` by default. Set `OLLAMA_MODEL`, `OLLAMA_URL`, `HOST`, or `PORT` to override those values.
