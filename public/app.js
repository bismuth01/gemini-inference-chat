const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chatForm");
const inputEl = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const template = document.getElementById("messageTemplate");
const clearChatButton = document.getElementById("clearChat");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const uploadButton = document.getElementById("uploadButton");
const fileInputEl = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");

const history = [];
let uploadedFiles = [];
const MAX_FILE_TEXT_CHARS = 50000;
const MAX_TOTAL_FILE_CONTEXT_CHARS = 120000;

function addMessage(role, content) {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector(".message-row");
  const bubble = fragment.querySelector(".bubble");

  row.classList.add(role);
  renderBubbleContent(bubble, role, content);

  messagesEl.appendChild(fragment);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendInlineMarkdown(target, text) {
  const tokenRegex = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    const plainText = text.slice(lastIndex, match.index);
    if (plainText) {
      target.appendChild(document.createTextNode(plainText));
    }

    if (typeof match[1] === "string" && match[1].length) {
      const inlineCode = document.createElement("code");
      inlineCode.className = "inline-code";
      inlineCode.textContent = match[1];
      target.appendChild(inlineCode);
    } else if (typeof match[2] === "string" && match[2].length) {
      const strong = document.createElement("strong");
      strong.className = "inline-strong";
      strong.textContent = match[2];
      target.appendChild(strong);
    } else if (typeof match[3] === "string" && match[3].length) {
      const em = document.createElement("em");
      em.className = "inline-em";
      em.textContent = match[3];
      target.appendChild(em);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  const tail = text.slice(lastIndex);
  if (tail) {
    target.appendChild(document.createTextNode(tail));
  }
}

function createMarkdownBlock(markdownText) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-markdown";

  const lines = String(markdownText || "").replace(/\r/g, "").split("\n");
  let paragraphLines = [];
  const listStack = [];

  function closeLists(minIndent = -1) {
    while (listStack.length && listStack[listStack.length - 1].indent > minIndent) {
      listStack.pop();
    }
  }

  function startList(indent, isOrdered) {
    const list = document.createElement(isOrdered ? "ol" : "ul");
    list.className = isOrdered ? "message-list message-list-ordered" : "message-list";

    if (!listStack.length) {
      wrapper.appendChild(list);
      listStack.push({ indent, isOrdered, element: list, lastItem: null });
      return;
    }

    const parent = listStack[listStack.length - 1];

    if (indent > parent.indent && parent.lastItem) {
      parent.lastItem.appendChild(list);
      listStack.push({ indent, isOrdered, element: list, lastItem: null });
      return;
    }

    const parentListItem = parent.element.parentElement;
    if (parentListItem && parentListItem.tagName === "LI") {
      parentListItem.appendChild(list);
    } else {
      wrapper.appendChild(list);
    }

    listStack.push({ indent, isOrdered, element: list, lastItem: null });
  }

  function flushParagraph() {
    if (!paragraphLines.length) {
      return;
    }

    closeLists();

    const paragraph = document.createElement("p");
    paragraph.className = "message-paragraph";
    appendInlineMarkdown(paragraph, paragraphLines.join("\n"));
    wrapper.appendChild(paragraph);
    paragraphLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeLists();
      continue;
    }

    const listMatch = line.match(/^(\s*)([*-]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      flushParagraph();

      const indent = listMatch[1].replace(/\t/g, "    ").length;
      const marker = listMatch[2];
      const content = listMatch[3];
      const isOrdered = /\d+\./.test(marker);

      while (listStack.length && indent < listStack[listStack.length - 1].indent) {
        listStack.pop();
      }

      if (
        !listStack.length ||
        indent > listStack[listStack.length - 1].indent ||
        listStack[listStack.length - 1].isOrdered !== isOrdered
      ) {
        startList(indent, isOrdered);
      }

      const activeList = listStack[listStack.length - 1];
      const item = document.createElement("li");
      item.className = "message-list-item";
      appendInlineMarkdown(item, content);
      activeList.element.appendChild(item);
      activeList.lastItem = item;
      continue;
    }

    closeLists();

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const heading = document.createElement(`h${level}`);
      heading.className = "message-heading";
      appendInlineMarkdown(heading, headingMatch[2]);
      wrapper.appendChild(heading);
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      const hr = document.createElement("hr");
      hr.className = "message-separator";
      wrapper.appendChild(hr);
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  closeLists();

  if (!wrapper.childNodes.length) {
    const fallback = document.createElement("p");
    fallback.className = "message-paragraph";
    fallback.textContent = markdownText;
    wrapper.appendChild(fallback);
  }

  return wrapper;
}

function createCodeBlock(language, code) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-block-header";

  const languageLabel = document.createElement("span");
  languageLabel.textContent = language || "code";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "copy-code-btn";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    } catch (error) {
      copyButton.textContent = "Copy failed";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    }
  });

  header.appendChild(languageLabel);
  header.appendChild(copyButton);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code;
  pre.appendChild(codeEl);

  wrapper.appendChild(header);
  wrapper.appendChild(pre);
  return wrapper;
}

function renderBubbleContent(container, role, content) {
  container.innerHTML = "";

  if (role !== "assistant") {
    container.textContent = content;
    return;
  }

  const blockRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = blockRegex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before) {
      container.appendChild(createMarkdownBlock(before));
    }

    const language = (match[1] || "").trim();
    const code = match[2] || "";
    container.appendChild(createCodeBlock(language, code));

    lastIndex = blockRegex.lastIndex;
  }

  const tail = content.slice(lastIndex);
  if (tail) {
    container.appendChild(createMarkdownBlock(tail));
  }

  if (!container.childNodes.length) {
    container.textContent = content;
  }
}

function setBusy(isBusy, status = "Ready") {
  sendButton.disabled = isBusy;
  inputEl.disabled = isBusy;
  uploadButton.disabled = isBusy;
  statusText.textContent = status;
  statusDot.style.background = isBusy ? "#ffd166" : "#67d5b5";
}

function autoGrowTextarea(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}

inputEl.addEventListener("input", () => autoGrowTextarea(inputEl));

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes}B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function renderFileChips() {
  fileListEl.innerHTML = "";

  for (const file of uploadedFiles) {
    const chip = document.createElement("span");
    chip.className = "file-chip";
    chip.textContent = `${file.name} (${formatBytes(file.size)})`;
    fileListEl.appendChild(chip);
  }
}

async function parseSelectedFiles(fileList) {
  const files = Array.from(fileList || []);

  if (!files.length) {
    return [];
  }

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch("/api/parse-files", {
    method: "POST",
    body: formData
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Failed to parse uploaded files.");
  }

  const parsedFiles = Array.isArray(payload.files) ? payload.files : [];
  return parsedFiles.map((file) => ({
    name: file.name,
    size: Number(file.size || 0),
    text: typeof file.text === "string" ? file.text.slice(0, MAX_FILE_TEXT_CHARS) : "",
    error: typeof file.error === "string" ? file.error : ""
  }));
}

function buildFileContext() {
  if (!uploadedFiles.length) {
    return "";
  }

  const joined = uploadedFiles
    .map(
      (file) =>
        `File: ${file.name}\n--- START ---\n${file.text}\n--- END ---`
    )
    .join("\n\n");

  return joined.slice(0, MAX_TOTAL_FILE_CONTEXT_CHARS);
}

uploadButton.addEventListener("click", () => {
  fileInputEl.click();
});

fileInputEl.addEventListener("change", async () => {
  try {
    setBusy(true, "Parsing files...");
    uploadedFiles = await parseSelectedFiles(fileInputEl.files);
    renderFileChips();
    const failedCount = uploadedFiles.filter((file) => file.error).length;
    if (failedCount) {
      addMessage(
        "assistant",
        `Some files could not be parsed (${failedCount}). Upload text/code files or PDFs.`
      );
    }
    setBusy(false, uploadedFiles.length ? "Files ready" : "Ready");
  } catch (error) {
    uploadedFiles = [];
    renderFileChips();
    setBusy(false, "File parse error");
    addMessage("assistant", "Error: Failed to parse selected files.");
  }
});

clearChatButton.addEventListener("click", () => {
  history.length = 0;
  uploadedFiles = [];
  fileInputEl.value = "";
  renderFileChips();
  messagesEl.innerHTML = "";
  addMessage("assistant", "Conversation cleared. Ask your next question.");
});

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = inputEl.value.trim();

  if (!message) {
    return;
  }

  addMessage("user", message);
  history.push({ role: "user", content: message });

  inputEl.value = "";
  autoGrowTextarea(inputEl);

  const typingLabel = "Gemini is thinking...";
  setBusy(true, typingLabel);
  const fileContext = buildFileContext();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history,
        fileContext
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    const reply = typeof payload.reply === "string" ? payload.reply : "No response text.";

    addMessage("assistant", reply);
    history.push({ role: "assistant", content: reply });
    setBusy(false, "Ready");
  } catch (error) {
    const messageText =
      (error && error.message) ||
      "Something went wrong while requesting Gemini.";

    addMessage("assistant", `Error: ${messageText}`);
    setBusy(false, "Error");
  } finally {
    inputEl.disabled = false;
    inputEl.focus();
  }
});

addMessage("assistant", "Hello. Ask anything and I will reply using Google Gemini.");
autoGrowTextarea(inputEl);
