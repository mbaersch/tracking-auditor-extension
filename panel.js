// Panel UI controller. Capture wiring (chrome.devtools.network) is added in a
// follow-up step; for now this handles record/clear state and status display.

const recordBtn = document.getElementById('recordBtn');
const clearBtn  = document.getElementById('clearBtn');
const recDot    = document.getElementById('recDot');
const recCount  = document.getElementById('recCount');
const emptyEl   = document.getElementById('empty');
const blocksEl  = document.getElementById('blocks');

const state = {
  recording: false,
  blocks: [],   // [{ navUrl, navTime, events: [] }]
};

function totalEvents() {
  return state.blocks.reduce((n, b) => n + b.events.length, 0);
}

function renderStatus() {
  recCount.textContent = `${totalEvents()} events / ${state.blocks.length} blocks`;
  recDot.classList.toggle('live', state.recording);
  recordBtn.textContent = state.recording ? 'Stop' : 'Record';
  recordBtn.classList.toggle('recording', state.recording);
}

function render() {
  const has = totalEvents() > 0;
  emptyEl.hidden = has;
  // Block/event rendering is added with the capture step.
  renderStatus();
}

function setRecording(on) {
  state.recording = on;
  renderStatus();
}

recordBtn.addEventListener('click', () => setRecording(!state.recording));

clearBtn.addEventListener('click', () => {
  state.blocks = [];
  blocksEl.innerHTML = '';
  render();
});

render();
