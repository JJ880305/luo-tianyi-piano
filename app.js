const NOTES = [
  { note: "C4", solfege: "Do", key: "A", code: "KeyA", sample: "Samples/採樣_0_C4.mp3" },
  { note: "D4", solfege: "Re", key: "S", code: "KeyS", sample: "Samples/採樣_1_D4.mp3" },
  { note: "E4", solfege: "Mi", key: "D", code: "KeyD", sample: "Samples/採樣_2_E4.mp3" },
  { note: "F4", solfege: "Fa", key: "F", code: "KeyF", sample: "Samples/採樣_3_F4.mp3" },
  { note: "G4", solfege: "Sol", key: "G", code: "KeyG", sample: "Samples/採樣_4_G4.mp3" },
  { note: "A4", solfege: "La", key: "H", code: "KeyH", sample: "Samples/採樣_5_A4.mp3" },
  { note: "B4", solfege: "Si", key: "J", code: "KeyJ", sample: "Samples/採樣_6_B4.mp3" },
  { note: "C5", solfege: "Do", key: "K", code: "KeyK", sample: "Samples/採樣_7_C5.mp3" },
  { note: "D5", solfege: "Re", key: "L", code: "KeyL", sample: "Samples/採樣_8_D5.mp3" },
  { note: "E5", solfege: "Mi", key: ";", code: "Semicolon", sample: "Samples/採樣_9_E5.mp3" },
  { note: "F5", solfege: "Fa", key: "'", code: "Quote", sample: "Samples/採樣_10_F5.mp3" },
  { note: "G5", solfege: "Sol", key: "Enter", code: "Enter", sample: "Samples/採樣_11_G5.mp3" },
];

const piano = document.querySelector("#piano");
const status = document.querySelector("#audio-status");
const volumeInput = document.querySelector("#master-volume");
const volumeValue = document.querySelector("#volume-value");
const stopButton = document.querySelector("#stop-all");
const modeButtons = [...document.querySelectorAll("[data-label-mode]")];

const noteByCode = new Map(NOTES.map((entry) => [entry.code, entry]));
const keyElements = new Map();
const activeInputs = new Map();
const buffers = new Map();
const voices = new Set();
const inputVoices = new Map();

let audioContext;
let masterGain;
let currentMode = "note";
let loadingPromise;

function createKeyboard() {
  NOTES.forEach((entry, index) => {
    const key = document.createElement("button");
    key.type = "button";
    key.className = "piano-key";
    key.dataset.note = entry.note;
    key.style.setProperty("--key-accent", index < 7 ? "#36c9c4" : "#54aedd");
    key.setAttribute("aria-label", `${entry.note}，電腦按鍵 ${entry.key}`);
    key.innerHTML = `
      <span class="key-labels" aria-hidden="true">
        <span class="note-label">${entry.note}</span>
        <span class="computer-key">${entry.key === "Enter" ? "↵" : entry.key}</span>
      </span>
    `;

    key.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      key.setPointerCapture?.(event.pointerId);
      pressNote(entry, `pointer-${event.pointerId}`);
    });

    const releasePointer = (event) => releaseNote(entry, `pointer-${event.pointerId}`);
    key.addEventListener("pointerup", releasePointer);
    key.addEventListener("pointercancel", releasePointer);
    key.addEventListener("lostpointercapture", releasePointer);
    key.addEventListener("contextmenu", (event) => event.preventDefault());

    piano.append(key);
    keyElements.set(entry.note, key);
  });
}

function ensureAudioGraph() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = Number(volumeInput.value) / 100;
    masterGain.connect(audioContext.destination);
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

async function loadSamples() {
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const context = ensureAudioGraph();
    const results = await Promise.allSettled(
      NOTES.map(async (entry) => {
        const response = await fetch(encodeURI(entry.sample));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(data);
        buffers.set(entry.note, buffer);
      }),
    );

    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed === 0) {
      status.textContent = "12 個音色已就緒";
      status.dataset.state = "ready";
    } else {
      status.textContent = `${failed} 個音色載入失敗，請確認以本機伺服器開啟`;
      status.dataset.state = "error";
    }
  })();

  return loadingPromise;
}

function playNote(entry, inputId) {
  const context = ensureAudioGraph();
  const buffer = buffers.get(entry.note);

  if (!buffer) {
    loadSamples();
    return null;
  }

  const source = context.createBufferSource();
  const voiceGain = context.createGain();
  source.buffer = buffer;
  voiceGain.gain.setValueAtTime(0.0001, context.currentTime);
  voiceGain.gain.exponentialRampToValueAtTime(1, context.currentTime + 0.006);
  source.connect(voiceGain);
  voiceGain.connect(masterGain);

  const voice = { source, gain: voiceGain, inputId };
  voices.add(voice);
  inputVoices.set(inputId, voice);
  source.addEventListener("ended", () => {
    voices.delete(voice);
    if (inputVoices.get(inputId) === voice) inputVoices.delete(inputId);
    source.disconnect();
    voiceGain.disconnect();
  });
  source.start();
  return voice;
}

function stopVoice(voice) {
  if (!voice || !voices.has(voice)) return;

  const now = audioContext.currentTime;
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.008);
  voice.source.stop(now + 0.01);
  voices.delete(voice);
  if (inputVoices.get(voice.inputId) === voice) inputVoices.delete(voice.inputId);
}

function pressNote(entry, inputId) {
  if (activeInputs.has(inputId)) return;
  activeInputs.set(inputId, entry.note);
  updateKeyState(entry.note);
  playNote(entry, inputId);
}

function releaseNote(entry, inputId) {
  if (activeInputs.get(inputId) !== entry.note) return;
  activeInputs.delete(inputId);
  stopVoice(inputVoices.get(inputId));
  updateKeyState(entry.note);
}

function updateKeyState(note) {
  const isActive = [...activeInputs.values()].includes(note);
  keyElements.get(note)?.classList.toggle("is-active", isActive);
}

function stopAll() {
  voices.forEach(({ source }) => {
    try {
      source.stop();
    } catch {
      // The source may already have finished between the click and this loop.
    }
  });
  voices.clear();
  inputVoices.clear();
  activeInputs.clear();
  keyElements.forEach((key) => key.classList.remove("is-active"));
}

function setLabelMode(mode) {
  currentMode = mode;
  NOTES.forEach((entry) => {
    const label = keyElements.get(entry.note)?.querySelector(".note-label");
    if (label) label.textContent = entry[currentMode];
  });

  modeButtons.forEach((button) => {
    const isSelected = button.dataset.labelMode === mode;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

document.addEventListener("keydown", (event) => {
  const entry = noteByCode.get(event.code);
  if (!entry || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  pressNote(entry, `keyboard-${event.code}`);
});

document.addEventListener("keyup", (event) => {
  const entry = noteByCode.get(event.code);
  if (!entry) return;
  event.preventDefault();
  releaseNote(entry, `keyboard-${event.code}`);
});

window.addEventListener("blur", () => {
  [...activeInputs.entries()]
    .filter(([inputId]) => inputId.startsWith("keyboard-"))
    .forEach(([inputId, note]) => {
      const entry = NOTES.find((candidate) => candidate.note === note);
      if (entry) releaseNote(entry, inputId);
    });
});

volumeInput.addEventListener("input", () => {
  const volume = Number(volumeInput.value);
  volumeValue.textContent = `${volume}%`;
  if (masterGain) {
    masterGain.gain.setTargetAtTime(volume / 100, audioContext.currentTime, 0.01);
  }
});

stopButton.addEventListener("click", stopAll);
modeButtons.forEach((button) => {
  button.addEventListener("click", () => setLabelMode(button.dataset.labelMode));
});

createKeyboard();

// Begin downloading immediately. AudioContext will resume on the first user gesture.
loadSamples();
