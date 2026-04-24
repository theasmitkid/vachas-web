const LRCLIB_API = "https://lrclib.net/api";
const LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/";
const LASTFM_API_KEY = "a0ed2629d3d28606f67d7214c916788d";
const LASTFM_API_SECRET = "295f31c5d28215215b1503fb0327cc01";
const LASTFM_SETTINGS_KEY = "lastfmSettings";
const LASTFM_SESSION_KEY = "lastfmSessionKey";
const LASTFM_TEMP_ENABLED_KEY = "lastfmTempEnabled";
const LASTFM_TIPS = [
    "Tip: drag songs by the handle to reorder the queue.",
    "Tip: shuffle changes the visible play order, then you can save it.",
    "Tip: lyrics lines are clickable and will seek the track.",
    "Tip: saving a playlist order writes the current queue to storage.",
    "Tip: the Last.fm minimum listen time is customizable in Settings."
];


let currentController = null;
let searchHasResults = false;
let currentVideo = null;
let currentPlaylist = null;

let player = null;
let playing = false;
let songUnavailable = false;
let progressInterval = null;
let isDragging = false;
let errorTimeout = null;
let countdownInterval = null;
let selectedVideoId = "";
let actualSelectedVideoId = null;
let currentVolume = parseInt(localStorage.getItem("volumeLevel"), 10) || 80;
let repeatSong = false;
let shuffleEnabled = false;
let seekUpdateFromPlayer = false;
let pendingVideo = null;

let lyricsLoadToken = 0;
let currentLyricsLines = [];
let currentLyricsSongId = null;
let currentLyricsMeta = null;
let lastHighlightedLyricIndex = -1;
let lyricsIsLoading = false;
let albumIsLoading = false;
let draggedTrackVideoId = null;
let dragOverTrackVideoId = null;
let dragInsertPosition = "before";
let dragDropIndex = null;
let playlistViewRenderQueued = false;
let lastfmSettings = loadLastFmSettings();
let lastfmSessionKey = localStorage.getItem(LASTFM_SESSION_KEY) || "";
let lastfmTempEnabled = getStoredLastFmTempEnabled();
let lastfmAuthPromise = null;
let lastfmScrobbleInFlight = false;
let lastfmRecentTrackTimer = null;
let lastfmSyncTimer = null;
let lastfmSyncInFlight = false;
let lastfmIdleTipTimer = null;
let lastfmCurrentTrack = null;
let lastfmCurrentTrackSent = false;
let lastfmCurrentTrackScrobbled = false;
let lastfmLastRecentTrackText = "";
let lastfmNowPlayingTrack = null;
let lastfmLastPlayedTrack = null;

const playlistOrderState = {};

const searchBox = document.getElementById("searchBox");
const searchInput = document.getElementById("searchInput");
const resultsDiv = document.getElementById("results");
const seekControl = document.getElementById("seekControl");
const volumeControl = document.getElementById("volumeControl");
const lyricsBox = document.getElementById("lyricsBox");
const lyricsTitle = document.getElementById("lyricsTitle");
const lyricsSubtitle = document.getElementById("lyricsSubtitle");
const lyricsContent = document.getElementById("lyricsContent");
const albumArtWrap = document.getElementById("albumArtWrap");
const albumArt = document.getElementById("albumArt");
const albumLoadingOverlay = document.getElementById("albumLoadingOverlay");
const lyricsLoadingOverlay = document.getElementById("lyricsLoadingOverlay");
const settingsModal = document.getElementById("settingsModal");
const currentTimeLabel = document.getElementById("currentTimeLabel");
const modal = document.getElementById("modal");
const usernameInput = document.getElementById("lastfmUsernameInput");
const passwordInput = document.getElementById("lastfmPasswordInput");
const minListenInput = document.getElementById("lastfmMinListenInput");
const permanentDisableInput = document.getElementById("lastfmPermanentDisableInput");
const playlistList = document.getElementById("playlistList");
const playlistView = document.getElementById("playlistView");
const newPlaylistName = document.getElementById("newPlaylistName");
const playPauseBtn = document.getElementById("playPauseBtn");
const errorMsg = document.getElementById("errorMessage");
const playbackTitle = document.getElementById("playbackTitle");
const playbackAuthor = document.getElementById("playbackAuthor");
const modalPlaylists = document.getElementById("modalPlaylists");
const durationLabel = document.getElementById("durationLabel");
const lastfmStatus = document.getElementById("lastfmStatus");
const lastfmNowPlaying = document.getElementById("lastfmNowPlaying");
const lastfmToggleBtn = document.getElementById("lastfmToggleBtn");

if (!localStorage.getItem("db")) {
    saveDB({ playlists: { "Default": [] } });
}

searchBox.addEventListener("mouseenter", () => {
    if (searchHasResults && !searchBox.classList.contains("loading")) {
        searchBox.classList.add("open");
    }
});

searchBox.addEventListener("mouseleave", () => {
    if (searchHasResults && !searchBox.classList.contains("loading")) {
        searchBox.classList.remove("open");
    }
});

searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        search();
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
});

function getDB() {
    try {
        const db = JSON.parse(localStorage.getItem("db"));
        return db && typeof db === "object" ? db : { playlists: {} };
    } catch {
        return { playlists: {} };
    }
}

function saveDB(db) {
    localStorage.setItem("db", JSON.stringify(db));
}

function savePlaybackStateToDB() {
    const db = getDB();
    db.playerState = {
        repeatSong: !!repeatSong,
    };
    saveDB(db);
}

function sanitizeTrackForDB(track) {
    if (!track || typeof track !== "object") return null;
    return {
        videoId: String(track.videoId || ""),
        songName: getTrackTitle(track),
        authorName: getTrackArtist(track),
        albumArt: getTrackCover(track),
        duration: Math.max(1, Number(track.duration) || 0)
    };
}

function normalizeLastFmRecentTrack(item) {
    const artist = typeof item?.artist === "string" ? item.artist : item?.artist?.["#text"] || "";
    const name = String(item?.name || "").trim();
    return {
        videoId: `lastfm:${normalizeText(artist)}:${normalizeText(name)}`,
        songName: name || "Unknown",
        authorName: artist || "Unknown",
        title: name || "Unknown",
        author: artist || "Unknown",
        albumArt: "",
        duration: Math.max(1, Number(item?.duration) || 0),
        source: "lastfm"
    };
}

function formatDuration(seconds) {
    const sec = Number.parseInt(seconds, 10);
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function pickThumbnail(video, preferredQualities = ["high", "medium", "default", "maxres", "maxresdefault", "sddefault"]) {
    const thumbs = Array.isArray(video?.videoThumbnails) ? video.videoThumbnails : [];
    for (const q of preferredQualities) {
        const found = thumbs.find(t => t && t.quality === q && t.url);
        if (found) return found.url;
    }
    return thumbs.find(t => t && t.url)?.url || "";
}

function normalizeVideo(video) {
    const coverurl = pickThumbnail(video, ["maxres", "maxresdefault", "sddefault", "high", "medium", "default"]);
    const thumb = pickThumbnail(video, ["default", "medium", "high", "sddefault", "maxresdefault"]);
    const songName = video.title || "Untitled";
    const authorName = video.author || "Unknown";
    const albumArt = thumb || coverurl;

    return {
        videoId: video.videoId,
        songName,
        authorName,
        albumArt,
        title: songName,
        author: authorName,
        coverurl,
        thumbnailUrl: albumArt,
        duration: Number(video.lengthSeconds) || 0,
        viewCountText: video.viewCountText || "",
        publishedText: video.publishedText || ""
    };
}

function getTrackThumb(track) {
    return track?.albumArt || track?.thumbnailUrl || track?.coverurl || "";
}

function getTrackCover(track) {
    return track?.coverurl || track?.albumArt || track?.thumbnailUrl || "";
}

function getTrackTitle(track) {
    return track?.songName || track?.title || "Untitled";
}

function getTrackArtist(track) {
    return track?.authorName || track?.author || "Unknown";
}

function setControlButtonActive(button, active) {
    button.classList.toggle("active-toggle", !!active);
}

function syncToggleButtons() {
    const shuffleBtn = document.querySelector('.control-buttons button[onclick="toggleShuffle()"]');
    const repeatBtn = document.querySelector('.control-buttons button[onclick="toggleRepeat()"]');
    setControlButtonActive(shuffleBtn, shuffleEnabled);
    setControlButtonActive(repeatBtn, repeatSong);
}

function setAlbumLoading(isLoading) {
    albumIsLoading = !!isLoading;
    if (albumArtWrap) albumArtWrap.classList.toggle("loading", albumIsLoading);
}

function setLyricsLoading(isLoading) {
    lyricsIsLoading = !!isLoading;
    if (lyricsBox) lyricsBox.classList.toggle("loading", lyricsIsLoading);
}

function arraysEqualById(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function getSavedPlaylistTracks(name) {
    const db = getDB();
    return Array.isArray(db.playlists?.[name]) ? db.playlists[name] : [];
}

function getPlaylistState(name) {
    const tracks = getSavedPlaylistTracks(name);
    let state = playlistOrderState[name];
    if (!state) {
        state = playlistOrderState[name] = {
            order: tracks.map(track => track.videoId),
            dirty: false,
            source: "db"
        };
    }

    const dbIds = tracks.map(track => track.videoId);
    const seen = new Set();
    state.order = state.order.filter((id) => {
        if (!dbIds.includes(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    for (const track of tracks) {
        if (!state.order.includes(track.videoId)) state.order.push(track.videoId);
    }
    if (!state.order.length && tracks.length) {
        state.order = tracks.map(track => track.videoId);
    }
    if (!state.source) state.source = "db";
    return state;
}

function getPlaylistTracksInWorkingOrder(name = currentPlaylist) {
    const tracks = getSavedPlaylistTracks(name);
    const map = new Map(tracks.map(track => [track.videoId, track]));
    const state = getPlaylistState(name);
    return state.order.map((id) => map.get(id)).filter(Boolean);
}

function setPlaylistWorkingOrder(name, orderedTracks, source = "manual") {
    const state = getPlaylistState(name);
    state.order = orderedTracks.map(track => track.videoId);
    state.dirty = true;
    state.source = source;
}

function savePlaylistOrder(name = currentPlaylist) {
    const db = getDB();
    const orderedTracks = getPlaylistTracksInWorkingOrder(name);
    db.playlists[name] = orderedTracks;
    saveDB(db);
    const state = getPlaylistState(name);
    state.dirty = false;
    resetPlaylistDragState();
    renderPlaylists();
    renderPlaylistView();
}

function setPlaylistToDbOrder(name) {
    const dbTracks = getSavedPlaylistTracks(name);
    const state = getPlaylistState(name);
    state.order = dbTracks.map(track => track.videoId);
    state.dirty = false;
    state.source = "db";
}

function resetPlaylistDragState() {
    draggedTrackVideoId = null;
    dragOverTrackVideoId = null;
    dragInsertPosition = "before";
    dragDropIndex = null;
    playlistViewRenderQueued = false;
}

function schedulePlaylistViewRender() {
    if (playlistViewRenderQueued) return;
    playlistViewRenderQueued = true;
    requestAnimationFrame(() => {
        playlistViewRenderQueued = false;
        renderPlaylistView();
    });
}

function shuffleArray(items) {
    const arr = items.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function syncControlToggleState() {
    syncToggleButtons();
}

function setCurrentPlayingIndicatorsLoading(show) {
    setAlbumLoading(show);
}

function clearSearch() {
    if (currentController) {
        currentController.abort();
        currentController = null;
    }

    searchInput.value = "";
    resultsDiv.innerHTML = "";
    searchHasResults = false;
    searchBox.classList.remove("open", "loading");
}

async function search() {
    if (currentController) currentController.abort();

    const query = searchInput.value.trim();
    if (!query) {
        clearSearch();
        return;
    }

    resultsDiv.innerHTML = "";
    searchHasResults = false;
    searchBox.classList.remove("open");
    searchBox.classList.add("loading");

    currentController = new AbortController();
    const { signal } = currentController;

    await nextPaint();

    try {
        const res = await fetch(
            `https://inv.thepixora.com/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
            { signal }
        );

        if (!res.ok) {
            throw new Error(`Search failed: ${res.status}`);
        }

        const videos = await res.json();

        if (!Array.isArray(videos) || videos.length === 0) {
            resultsDiv.innerHTML = `<div class="empty-state">No results found.</div>`;
            searchHasResults = false;
            searchBox.classList.add("open");
            return;
        }

        const normalizedVideos = videos.map(normalizeVideo);
        searchHasResults = true;

        normalizedVideos.forEach((vObj) => {
            const duration = formatDuration(vObj.duration);

            const el = document.createElement("div");
            el.className = "video";

            const thumbWrap = document.createElement("div");
            thumbWrap.className = "thumb";

            const img = document.createElement("img");
            img.src = vObj.thumbnailUrl;
            img.alt = vObj.songName;
            img.loading = "lazy";

            const dur = document.createElement("span");
            dur.className = "duration";
            dur.textContent = duration;

            thumbWrap.appendChild(img);
            thumbWrap.appendChild(dur);

            const info = document.createElement("div");
            info.className = "info";

            const title = document.createElement("div");
            title.className = "title";
            title.textContent = vObj.songName;

            const meta1 = document.createElement("div");
            meta1.className = "meta";
            meta1.textContent = vObj.authorName;

            const meta2 = document.createElement("div");
            meta2.className = "meta";
            meta2.textContent = `${vObj.viewCountText}${vObj.viewCountText && vObj.publishedText ? " • " : ""}${vObj.publishedText}`.trim();

            info.appendChild(title);
            info.appendChild(meta1);
            if (vObj.viewCountText || vObj.publishedText) info.appendChild(meta2);

            const addBtn = document.createElement("button");
            addBtn.className = "add-to-playlist";
            addBtn.textContent = "+";
            addBtn.title = "Add to playlist";
            addBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                openModal(vObj);
            });

            const play = () => playTrack(vObj);
            thumbWrap.addEventListener("click", play);
            info.addEventListener("click", play);

            el.appendChild(thumbWrap);
            el.appendChild(info);
            el.appendChild(addBtn);
            resultsDiv.appendChild(el);
        });

        searchBox.classList.add("open");
    } catch (error) {
        if (error.name !== "AbortError") {
            console.error(error);
            resultsDiv.innerHTML = `<div class="empty-state">Search failed. Please try again.</div>`;
            searchHasResults = false;
            searchBox.classList.add("open");
        }
    } finally {
        searchBox.classList.remove("loading");
        currentController = null;
    }
}

function getLyricsLinesFromText(text) {
    const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!normalized) return null;
    return [{ time: 0, text: normalized }];
}

function parseSyncedLyrics(rawLyrics) {
    const raw = String(rawLyrics || "").replace(/\r\n/g, "\n").trim();
    if (!raw) return null;

    const lines = [];
    const rows = raw.split("\n");

    for (const row of rows) {
        const timestampMatches = [...row.matchAll(/\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/g)];
        const text = row.replace(/\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/g, "").trim();

        if (!timestampMatches.length) {
            continue;
        }

        for (const match of timestampMatches) {
            const minutes = Number(match[1]) || 0;
            const seconds = Number(match[2]) || 0;
            const fraction = match[3] ? Number(String(match[3]).padEnd(3, "0")) : 0;
            const time = (minutes * 60) + seconds + (fraction / 1000);
            lines.push({ time, text });
        }
    }

    lines.sort((a, b) => a.time - b.time);

    return lines.length ? lines : null;
}

function plainFromSyncedLines(lines) {
    if (!Array.isArray(lines) || !lines.length) return "";
    return lines.map(line => line?.text || "").join("\n").trim();
}

function buildLyricsPayloadFromRecord(record) {
    if (!record || typeof record !== "object") return null;

    const synced = parseSyncedLyrics(record.syncedLyrics);
    if (synced && synced.length) {
        return {
            source: "lrclib",
            synced: true,
            lines: synced
        };
    }

    const plain = record.plainLyrics || record.lyrics || "";
    const forced = getLyricsLinesFromText(plain);
    if (forced && forced.length) {
        return {
            source: "lrclib",
            synced: true,
            lines: forced
        };
    }

    return null;
}

function scoreLyricsCandidate(candidate, title, artist, durationMs) {
    const candidateTitle = normalizeText(candidate?.trackName || candidate?.track_name || candidate?.title);
    const candidateArtist = normalizeText(candidate?.artistName || candidate?.artist_name || candidate?.artist);
    const targetTitle = normalizeText(title);
    const targetArtist = normalizeText(artist);

    let score = 0;

    if (candidateTitle === targetTitle) score += 60;
    else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 35;

    if (targetArtist) {
        if (candidateArtist === targetArtist) score += 45;
        else if (candidateArtist.includes(targetArtist) || targetArtist.includes(candidateArtist)) score += 25;
    }

    const candidateDuration = Number(candidate?.duration) || 0;
    if (durationMs > 0 && candidateDuration > 0) {
        const diff = Math.abs(candidateDuration - durationMs);
        if (diff <= 1) score += 35;
        else if (diff <= 2) score += 25;
        else if (diff <= 5) score += 15;
        else if (diff <= 15) score += 5;
        score -= Math.min(diff / 1000, 20);
    }

    if (candidate?.syncedLyrics) score += 10;
    if (candidate?.plainLyrics) score += 3;

    return score;
}

function pickBestLyricsCandidate(results, title, artist, durationMs) {
    if (!Array.isArray(results) || !results.length) return null;

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of results) {
        if (!candidate || (candidate.syncedLyrics == null && candidate.plainLyrics == null)) continue;
        const score = scoreLyricsCandidate(candidate, title, artist, durationMs);
        if (score > bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    return best;
}

async function fetchJson(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
}

async function fetchLyricsRecord(track, signal) {
    const title = getTrackTitle(track);
    const artist = getTrackArtist(track);
    const durationSeconds = Math.max(0, Math.round(Number(track?.duration) || 0));

    const queries = [
        `${LRCLIB_API}/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&duration=${encodeURIComponent(durationSeconds)}`,
        `${LRCLIB_API}/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
        `${LRCLIB_API}/search?q=${encodeURIComponent(`${title} ${artist}`.trim())}`,
        `${LRCLIB_API}/search?q=${encodeURIComponent(title)}`
    ];

    for (const url of queries) {
        try {
            const data = await fetchJson(url, signal);

            if (Array.isArray(data)) {
                const best = pickBestLyricsCandidate(data, title, artist, durationSeconds);
                if (best) return best;
            } else if (data && typeof data === "object") {
                if (data.syncedLyrics || data.plainLyrics) return data;
            }
        } catch (err) {
            continue;
        }
    }

    return null;
}

function makeStoredLyrics(track, record) {
    const payload = buildLyricsPayloadFromRecord(record);
    if (!payload) return null;

    return {
        source: payload.source,
        synced: true,
        lines: payload.lines.map(line => ({
            time: Number(line.time) || 0,
            text: String(line.text || "")
        }))
    };
}

function updateTrackInAllPlaylists(videoId, updater) {
    const db = getDB();
    let changed = false;

    for (const playlistName of Object.keys(db.playlists || {})) {
        const playlist = Array.isArray(db.playlists[playlistName]) ? db.playlists[playlistName] : [];
        db.playlists[playlistName] = playlist.map((track) => {
            if (!track || track.videoId !== videoId) return track;
            changed = true;
            return updater({ ...track });
        });
    }

    if (changed) saveDB(db);
    return changed;
}

function updateCurrentLyricsFromTrack(track) {
    currentLyricsSongId = track?.videoId || null;
    currentLyricsMeta = track || null;
    currentLyricsLines = Array.isArray(track?.lyrics?.lines) ? track.lyrics.lines.slice().sort((a, b) => a.time - b.time) : [];
    lastHighlightedLyricIndex = -1;
    renderLyricsPanel();
}


function renderLyricsPanel() {
    const title = getTrackTitle(currentLyricsMeta);
    const artist = getTrackArtist(currentLyricsMeta);

    lyricsTitle.textContent = "Lyrics";
    lyricsSubtitle.textContent = currentLyricsMeta ? `${title} • ${artist}` : "Nothing playing";
    lyricsContent.innerHTML = "";

    if (!currentLyricsMeta) {
        const empty = document.createElement("div");
        empty.className = "lyrics-empty";
        empty.textContent = "Play a song to view lyrics.";
        lyricsContent.appendChild(empty);
        setLyricsLoading(false);
        return;
    }

    if (lyricsIsLoading) {
        const loading = document.createElement("div");
        loading.className = "lyrics-empty";
        loading.textContent = "Loading lyrics…";
        lyricsContent.appendChild(loading);
    }

    if (!currentLyricsLines.length && !lyricsIsLoading) {
        const empty = document.createElement("div");
        empty.className = "lyrics-empty";
        empty.textContent = "No lyrics found for this track.";
        lyricsContent.appendChild(empty);
        return;
    }

    currentLyricsLines.forEach((line, index) => {
        const div = document.createElement("div");
        div.className = "lyrics-line";
        div.dataset.index = String(index);
        div.dataset.time = String(Number(line.time) || 0);
        div.textContent = line.text || " ";
        div.addEventListener("click", () => seekToTime(Number(line.time) || 0));
        lyricsContent.appendChild(div);
    });
}

function seekToTime(timeInSeconds) {
    if (!player || typeof player.seekTo !== "function") return;
    const time = Math.max(0, Number(timeInSeconds) || 0);
    player.seekTo(time, true);
    currentTimeLabel.innerText = formatTime(time);
    const duration = player.getDuration ? player.getDuration() : 0;
    if (duration > 0) {
        seekUpdateFromPlayer = true;
        seekControl.value = String(Math.max(0, Math.min(100, (time / duration) * 100)));
        seekUpdateFromPlayer = false;
    }
    highlightLyricsAtTime(time);
}

function highlightLyricsAtTime(currentTime) {
    if (!currentLyricsLines.length) return;

    let activeIndex = 0;
    for (let i = 0; i < currentLyricsLines.length; i += 1) {
        if (currentTime >= (Number(currentLyricsLines[i].time) || 0)) {
            activeIndex = i;
        } else {
            break;
        }
    }

    if (activeIndex === lastHighlightedLyricIndex) return;
    lastHighlightedLyricIndex = activeIndex;

    const nodes = lyricsContent.querySelectorAll(".lyrics-line");
    nodes.forEach((node, index) => {
        node.classList.toggle("active", index === activeIndex);
    });

    const activeNode = lyricsContent.querySelector(`.lyrics-line[data-index="${activeIndex}"]`);
    if (activeNode) {
        activeNode.scrollIntoView({ block: "center", behavior: "smooth" });
    }
}

async function ensureLyricsForTrack(track, { persist = false } = {}) {
    if (!track || !track.videoId) return track || null;

    if (track.lyrics?.lines?.length) {
        const normalized = {
            ...track,
            lyrics: {
                source: track.lyrics.source || "lrclib",
                synced: true,
                lines: track.lyrics.lines.map(line => ({
                    time: Number(line.time) || 0,
                    text: String(line.text || "")
                }))
            }
        };

        if (persist) {
            updateTrackInAllPlaylists(track.videoId, () => normalized);
        }

        return normalized;
    }

    const token = ++lyricsLoadToken;
    const controller = new AbortController();

    let record = null;
    try {
        record = await fetchLyricsRecord(track, controller.signal);
    } catch {
        record = null;
    }

    if (token !== lyricsLoadToken) {
        return track;
    }

    if (!record) return track;

    const lyrics = makeStoredLyrics(track, record);
    if (!lyrics) return track;

    const enriched = {
        ...track,
        lyrics
    };

    if (persist) {
        updateTrackInAllPlaylists(track.videoId, () => enriched);
    }

    return enriched;
}

function renderTrackListRows(items) {
    items.forEach((v) => {
        const row = document.createElement("div");
        row.className = "video";
        row.setAttribute("data-video", v.videoId);

        if (v.videoId === actualSelectedVideoId || v.videoId === selectedVideoId) {
            row.classList.add("selected");
        }

        const cover = makeSquareThumb(getTrackThumb(v), v.songName || "Track cover");
        cover.title = "Play track";
        cover.onclick = () => playTrack(v);

        const info = document.createElement("div");
        info.className = "info";

        const title = document.createElement("div");
        title.className = "title";
        title.textContent = v.songName || "Untitled";

        const author = document.createElement("div");
        author.className = "meta";
        author.textContent = v.authorName || "Unknown";

        const duration = document.createElement("div");
        duration.className = "meta";
        duration.textContent = formatDuration(v.duration || 0);

        info.appendChild(title);
        info.appendChild(author);
        info.appendChild(duration);

        const removeBtn = document.createElement("button");
        removeBtn.className = "delete-track-btn";
        removeBtn.textContent = "✕";
        removeBtn.title = "Delete from playlist";
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFromPlaylist(v.videoId);
        };

        row.appendChild(cover);
        row.appendChild(info);
        row.appendChild(removeBtn);
        row.onclick = (e) => {
            if (e.target.closest(".delete-track-btn") || e.target.closest(".track-cover-btn")) return;
            playTrack(v);
        };

        return row;
    });
}


function renderPlaylists() {
    const db = getDB();
    playlistList.innerHTML = "";

    const names = Object.keys(db.playlists);

    if (!names.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No playlists yet.";
        playlistList.appendChild(empty);
        return;
    }

    if (!currentPlaylist || !db.playlists[currentPlaylist]) {
        currentPlaylist = names[0];
    }

    names.forEach(name => {
        const row = document.createElement("div");
        row.className = "playlist-row" + (name === currentPlaylist ? " active" : "");

        const div = document.createElement("div");
        div.className = "playlist-item" + (name === currentPlaylist ? " active" : "");
        div.onclick = () => {
            currentPlaylist = name;
            renderPlaylists();
            renderPlaylistView();
        };

        const nameSpan = document.createElement("div");
        nameSpan.className = "playlist-item-name";
        nameSpan.textContent = name;
        div.appendChild(nameSpan);

        row.appendChild(div);

        const actions = document.createElement("div");
        actions.className = "playlist-actions";

        const state = getPlaylistState(name);
        const hasSave = name === currentPlaylist && state.dirty;

        if (hasSave) {
            const save = document.createElement("button");
            save.className = "playlist-save-btn action-left";
            save.type = "button";
            save.innerHTML = '<i class="bi bi-floppy"></i>';
            save.title = "Save current order";
            save.onclick = (e) => {
                e.stopPropagation();
                savePlaylistOrder(name);
            };
            actions.appendChild(save);
        }

        const del = document.createElement("button");
        del.className = hasSave ? "delete-playlist-btn action-right" : "delete-playlist-btn";
        del.type = "button";
        del.innerHTML = '<i class="bi bi-trash"></i>';
        del.title = "Delete playlist";
        del.onclick = (e) => {
            e.stopPropagation();
            deletePlaylist(name);
        };
        actions.appendChild(del);

        row.appendChild(actions);
        playlistList.appendChild(row);
    });
}

function renderPlaylistView() {
    const db = getDB();
    playlistView.innerHTML = "";

    const names = Object.keys(db.playlists);
    if (!names.length) {
        playlistView.innerHTML = `<div class="empty-state">Create a playlist to get started.</div>`;
        return;
    }

    if (!currentPlaylist || !db.playlists[currentPlaylist]) {
        currentPlaylist = names[0];
    }

    const orderedTracks = getPlaylistTracksInWorkingOrder(currentPlaylist);
    const dropIndex = draggedTrackVideoId === null ? null : (dragDropIndex ?? orderedTracks.length);

    if (!orderedTracks.length) {
        playlistView.innerHTML = `<div class="empty-state">"${currentPlaylist}" is empty.</div>`;
        return;
    }

    playlistView.ondragover = onPlaylistViewDragOver;
    playlistView.ondrop = onPlaylistViewDrop;

    function appendDropPlaceholder(parent) {
        const placeholder = document.createElement("div");
        placeholder.className = "playlist-drop-placeholder";
        parent.appendChild(placeholder);
    }

    orderedTracks.forEach((v, index) => {
        if (dropIndex !== null && dropIndex === index) {
            appendDropPlaceholder(playlistView);
        }

        const row = document.createElement("div");
        row.className = "video";
        row.setAttribute("data-video", v.videoId);
        row.draggable = true;

        if (v.videoId === actualSelectedVideoId || v.videoId === selectedVideoId) {
            row.classList.add("selected");
        }
        if (draggedTrackVideoId === v.videoId) {
            row.classList.add("dragging");
        }

        const cover = makeSquareThumb(getTrackThumb(v), v.songName || "Track cover");
        cover.title = "Play track";
        cover.onclick = () => playTrack(v);

        const info = document.createElement("div");
        info.className = "info";

        const title = document.createElement("div");
        title.className = "title";
        title.textContent = v.songName || "Untitled";

        const author = document.createElement("div");
        author.className = "meta";
        author.textContent = v.authorName || "Unknown";

        const duration = document.createElement("div");
        duration.className = "meta";
        duration.textContent = formatDuration(v.duration || 0);

        info.appendChild(title);
        info.appendChild(author);
        info.appendChild(duration);

        const actions = document.createElement("div");
        actions.className = "playlist-actions";

        const dragBtn = document.createElement("button");
        dragBtn.className = "drag-handle action-left";
        dragBtn.type = "button";
        dragBtn.title = "Drag to reorder";
        dragBtn.innerHTML = '<i class="bi bi-grip-vertical"></i>';
        dragBtn.draggable = false;
        dragBtn.addEventListener("click", (e) => e.preventDefault());

        const removeBtn = document.createElement("button");
        removeBtn.className = "delete-track-btn action-right";
        removeBtn.type = "button";
        removeBtn.innerHTML = '<i class="bi bi-trash"></i>';
        removeBtn.title = "Delete from playlist";
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFromPlaylist(v.videoId);
        };

        actions.appendChild(dragBtn);
        actions.appendChild(removeBtn);

        row.appendChild(cover);
        row.appendChild(info);
        row.appendChild(actions);

        row.addEventListener("dragstart", (e) => {
            if (e.target.closest(".delete-track-btn") || e.target.closest(".track-cover-btn")) {
                e.preventDefault();
                return;
            }
            draggedTrackVideoId = v.videoId;
            dragDropIndex = index;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", v.videoId);
            e.dataTransfer.setDragImage(row, row.clientWidth / 2, row.clientHeight / 2);
            schedulePlaylistViewRender();
        });

        row.addEventListener("dragover", (e) => {
            if (!draggedTrackVideoId || draggedTrackVideoId === v.videoId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const nextDropIndex = e.offsetY < (row.offsetHeight / 2) ? index : index + 1;
            if (dragDropIndex !== nextDropIndex) {
                dragDropIndex = nextDropIndex;
                schedulePlaylistViewRender();
            }
        });

        row.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!draggedTrackVideoId) return;
            const state = getPlaylistState(currentPlaylist);
            const ids = state.order.slice();
            const from = ids.indexOf(draggedTrackVideoId);
            let insertAt = dragDropIndex;
            if (insertAt === null || insertAt === undefined) insertAt = ids.length;
            if (from < 0) return;
            ids.splice(from, 1);
            if (from < insertAt) insertAt -= 1;
            insertAt = Math.max(0, Math.min(insertAt, ids.length));
            ids.splice(insertAt, 0, draggedTrackVideoId);
            state.order = ids;
            state.dirty = true;
            state.source = "manual";
            resetPlaylistDragState();
            renderPlaylists();
            renderPlaylistView();
        });

        row.addEventListener("dragend", () => {
            resetPlaylistDragState();
            renderPlaylistView();
        });

        row.onclick = (e) => {
            if (e.target.closest(".delete-track-btn") || e.target.closest(".track-cover-btn") || e.target.closest(".drag-handle")) return;
            playTrack(v);
        };

        playlistView.appendChild(row);
    });

    if (dropIndex !== null && dropIndex === orderedTracks.length) {
        appendDropPlaceholder(playlistView);
    }
}

function onPlaylistViewDragOver(e) {
    if (!draggedTrackVideoId) return;
    e.preventDefault();
    if (!playlistView) return;
    const rows = Array.from(playlistView.querySelectorAll('.video[data-video]'));
    if (!rows.length) {
        if (dragDropIndex !== 0) {
            dragDropIndex = 0;
            schedulePlaylistViewRender();
        }
        return;
    }
    const lastRow = rows[rows.length - 1];
    const rect = lastRow.getBoundingClientRect();
    if (e.clientY > rect.bottom) {
        if (dragDropIndex !== rows.length) {
            dragDropIndex = rows.length;
            schedulePlaylistViewRender();
        }
    }
}

function onPlaylistViewDrop(e) {
    if (!draggedTrackVideoId || e.target !== e.currentTarget) return;
    e.preventDefault();
    const state = getPlaylistState(currentPlaylist);
    const ids = state.order.slice();
    const from = ids.indexOf(draggedTrackVideoId);
    let insertAt = dragDropIndex;
    if (insertAt === null || insertAt === undefined) insertAt = ids.length;
    if (from < 0) return;
    ids.splice(from, 1);
    if (from < insertAt) insertAt -= 1;
    insertAt = Math.max(0, Math.min(insertAt, ids.length));
    ids.splice(insertAt, 0, draggedTrackVideoId);
    state.order = ids;
    state.dirty = true;
    state.source = "manual";
    resetPlaylistDragState();
    renderPlaylists();
    renderPlaylistView();
}

function makeSquareThumb(url, title) {
    const wrap = document.createElement("button");
    wrap.className = "track-cover-btn square-thumb";
    wrap.title = "Open track";

    const img = document.createElement("img");
    img.className = "thumb-fg";
    img.src = url || "";
    img.alt = title || "Track cover";

    const overlay = document.createElement("span");
    overlay.className = "play-overlay";
    overlay.textContent = "▶";

    wrap.appendChild(img);
    wrap.appendChild(overlay);
    return wrap;
}

function renderModalPlaylists() {
    const db = getDB();
    modalPlaylists.innerHTML = "";

    const names = Object.keys(db.playlists);

    if (!names.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.style.margin = "0";
        empty.textContent = "No playlists yet.";
        modalPlaylists.appendChild(empty);
        return;
    }

    names.forEach(name => {
        const btn = document.createElement("button");
        btn.textContent = name;
        btn.onclick = () => addToPlaylist(name);
        modalPlaylists.appendChild(btn);
    });
}

function openModal(videoData) {
    currentVideo = videoData;
    modal.style.display = "flex";
    renderModalPlaylists();
    newPlaylistName.value = "";
}

function closeModal() {
    modal.style.display = "none";
}

async function addToPlaylist(name) {
    if (!currentVideo) return;

    const db = getDB();
    if (!db.playlists[name]) db.playlists[name] = [];

    const trackToStore = {
        ...currentVideo,
        lyrics: currentVideo.lyrics?.lines?.length
            ? currentVideo.lyrics
            : null
    };

    const existsIndex = db.playlists[name].findIndex(v => v.videoId === currentVideo.videoId);

    if (existsIndex >= 0) {
        db.playlists[name][existsIndex] = {
            ...db.playlists[name][existsIndex],
            ...trackToStore
        };
    } else {
        db.playlists[name].push(trackToStore);
    }

    saveDB(db);

    currentPlaylist = name;
    closeModal();
    renderPlaylists();
    renderPlaylistView();

    void primeLyricsForTrack(trackToStore);
}

async function primeLyricsForTrack(track) {
    if (!track || !track.videoId) return;

    const controller = new AbortController();
    let record = null;
    try {
        record = await fetchLyricsRecord(track, controller.signal);
    } catch {
        record = null;
    }

    if (!record) return;

    const lyrics = makeStoredLyrics(track, record);
    if (!lyrics) return;

    const enriched = {
        ...track,
        lyrics
    };

    updateTrackInAllPlaylists(track.videoId, () => enriched);
    renderPlaylists();
    renderPlaylistView();

    if (currentLyricsSongId === enriched.videoId || actualSelectedVideoId === enriched.videoId || selectedVideoId === enriched.videoId) {
        currentLyricsMeta = enriched;
        currentLyricsLines = Array.isArray(enriched.lyrics?.lines) ? enriched.lyrics.lines.slice().sort((a, b) => a.time - b.time) : [];
        setLyricsLoading(false);
        renderLyricsPanel();
    }
}

function createPlaylist() {
    const name = newPlaylistName.value.trim();
    if (!name) return;

    const db = getDB();
    if (!db.playlists[name]) {
        db.playlists[name] = [];
        saveDB(db);
    }

    playlistOrderState[name] = {
        order: [],
        dirty: false,
        source: "db"
    };

    currentPlaylist = name;
    newPlaylistName.value = "";
    renderPlaylists();
    renderPlaylistView();
    renderModalPlaylists();
}

function deletePlaylist(name) {
    const db = getDB();
    if (!db.playlists[name]) return;

    if (!confirm(`Delete playlist "${name}"? This cannot be undone.`)) return;

    delete db.playlists[name];
    delete playlistOrderState[name];
    saveDB(db);

    const names = Object.keys(db.playlists);
    currentPlaylist = names[0] || null;

    renderPlaylists();
    renderPlaylistView();
}

function removeFromPlaylist(videoId) {
    const db = getDB();
    if (!currentPlaylist || !db.playlists[currentPlaylist]) return;

    const track = db.playlists[currentPlaylist].find(v => v.videoId === videoId);
    const title = getTrackTitle(track);

    if (!confirm(`Remove "${title}" from "${currentPlaylist}"?`)) return;

    db.playlists[currentPlaylist] = db.playlists[currentPlaylist].filter(v => v.videoId !== videoId);
    const state = playlistOrderState[currentPlaylist];
    if (state) {
        state.order = state.order.filter(id => id !== videoId);
        state.dirty = state.source !== "db" || !arraysEqualById(state.order, db.playlists[currentPlaylist].map(v => v.videoId));
    }
    saveDB(db);

    if (actualSelectedVideoId === videoId) {
        actualSelectedVideoId = null;
    }

    renderPlaylists();
    renderPlaylistView();
}

function loadYouTubeIframeAPI() {
    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) return;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName("script")[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

loadYouTubeIframeAPI();

window.onYouTubeIframeAPIReady = function () {
    const db = getDB();
    const names = Object.keys(db.playlists);
    const firstPlaylist = names[0];
    const firstSong = firstPlaylist ? (db.playlists[firstPlaylist] || [])[0] : null;
    selectedVideoId = firstSong ? firstSong.videoId : "";

    player = new YT.Player("player", {
        videoId: selectedVideoId,
        playerVars: {
            autoplay: 0,
            controls: 0,
            modestbranding: 1,
            showinfo: 0,
            rel: 0,
            fs: 0,
            iv_load_policy: 3,
            playsinline: 1
        },
        events: {
            onReady: (event) => {
                event.target.setVolume(currentVolume);
                if (selectedVideoId) {
                    event.target.cueVideoById(selectedVideoId);
                }
                if (pendingVideo) {
                    const { videoId, albumArtUrl, songObject } = pendingVideo;
                    pendingVideo = null;
                    loadNewVideo(videoId, albumArtUrl, songObject);
                }
            },
            onStateChange: handlePlayerStateChange,
            onError: handleVideoError
        }
    });
};

function setPlayPauseIcon(isPlaying) {
    if (!playPauseBtn) return;

    playPauseBtn.classList.remove("bx-play", "bx-pause");
    playPauseBtn.classList.add(isPlaying ? "bx-pause" : "bx-play");
}

function handlePlayerStateChange(event) {
    if (event.data === YT.PlayerState.BUFFERING) {
        setAlbumLoading(true);
    } else if (event.data === YT.PlayerState.PLAYING) {
        playing = true;
        songUnavailable = false;
        setAlbumLoading(false);
        setPlayPauseIcon(true);
        handleLastFmPlaybackStarted();
        updateProgressBar();
    } else if (event.data === YT.PlayerState.PAUSED) {
        playing = false;
        setAlbumLoading(false);
        setPlayPauseIcon(false);
        handleLastFmPlaybackPaused();
        clearInterval(progressInterval);
    } else if (event.data === YT.PlayerState.ENDED) {
        playing = false;
        clearInterval(progressInterval);
        setAlbumLoading(false);
        setPlayPauseIcon(false);
        handleLastFmPlaybackEnded();

        if (repeatSong) {
            player.seekTo(0, true);
            player.playVideo();
            return;
        }

        playNextSong();
    }
}

function handleVideoError() {
    playing = false;
    songUnavailable = true;
    clearInterval(progressInterval);

    if (player && typeof player.pauseVideo === "function") {
        player.pauseVideo();
    }

    setPlayPauseIcon(false);

    if (errorMsg) {
        errorMsg.style.display = "block";
        errorMsg.innerText = "This video is unavailable.";
    }
}

function resetErrorState() {
    clearInterval(countdownInterval);
    if (errorMsg) {
        errorMsg.style.display = "none";
        errorMsg.innerHTML = "";
    }
}

function removeArtistFromTitle(title, artist) {
    if (!title) return title;

    let cleanedTitle = title.trim();

    if (artist) {
        const pattern = new RegExp(`^${artist}\\s*-?\\s*`, "i");
        cleanedTitle = cleanedTitle.replace(pattern, "").trim();
    }

    if (cleanedTitle.includes("-")) {
        cleanedTitle = cleanedTitle.split("-").slice(1).join("-").trim();
    }

    return cleanedTitle;
}

function updateProgressBar() {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (!player || typeof player.getCurrentTime !== "function" || isDragging) return;

        const currentTime = player.getCurrentTime();
        const duration = player.getDuration ? player.getDuration() : 0;

        if (duration > 0) {
            const progressPercent = (currentTime / duration) * 100;

            seekUpdateFromPlayer = true;
            seekControl.value = String(Math.max(0, Math.min(100, progressPercent)));
            seekUpdateFromPlayer = false;

            currentTimeLabel.innerText = formatTime(currentTime);
            durationLabel.innerText = formatTime(duration);

            highlightLyricsAtTime(currentTime);
        }

        handleLastFmProgress(currentTime, duration);

        if (player.getPlayerState && player.getPlayerState() === YT.PlayerState.ENDED) {
            clearInterval(progressInterval);
        }
    }, 500);
}

function seekToSliderPosition() {
    if (!player || typeof player.seekTo !== "function") return;
    const duration = player.getDuration ? player.getDuration() : 0;
    if (duration <= 0) return;

    const percent = Number(seekControl.value) / 100;
    const seekTime = duration * percent;
    player.seekTo(seekTime, true);

    currentTimeLabel.innerText = formatTime(seekTime);
    highlightLyricsAtTime(seekTime);
}

seekControl.addEventListener("input", function () {
    if (seekUpdateFromPlayer) return;
    seekToSliderPosition();
});

seekControl.addEventListener("mousedown", function () {
    if (songUnavailable) return;
    isDragging = true;
});

seekControl.addEventListener("touchstart", function () {
    if (songUnavailable) return;
    isDragging = true;
}, { passive: true });

document.addEventListener("mouseup", function () {
    isDragging = false;
});

document.addEventListener("touchend", function () {
    isDragging = false;
});

volumeControl.addEventListener("input", function () {
    currentVolume = parseInt(this.value, 10) || 0;
    localStorage.setItem("volumeLevel", String(currentVolume));
    if (player && player.setVolume) {
        player.setVolume(currentVolume);
    }
});

function setupMediaSession() {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", function() {
        if (player && !playing) togglePlayPause();
    });

    navigator.mediaSession.setActionHandler("pause", function() {
        if (player && playing) togglePlayPause();
    });

    navigator.mediaSession.setActionHandler("previoustrack", function() {
        playPreviousSong();
    });

    navigator.mediaSession.setActionHandler("nexttrack", function() {
        playNextSong();
    });
}

async function loadLyricsForSong(song) {
    if (!song || !song.videoId) {
        currentLyricsSongId = null;
        currentLyricsMeta = null;
        currentLyricsLines = [];
        lastHighlightedLyricIndex = -1;
        setLyricsLoading(false);
        renderLyricsPanel();
        return;
    }

    currentLyricsSongId = song.videoId;
    currentLyricsMeta = song;
    lastHighlightedLyricIndex = -1;

    if (song.lyrics?.lines?.length) {
        currentLyricsLines = song.lyrics.lines.slice().sort((a, b) => a.time - b.time);
        setLyricsLoading(false);
        renderLyricsPanel();
        return;
    }

    currentLyricsLines = [];
    setLyricsLoading(true);
    renderLyricsPanel();

    const token = ++lyricsLoadToken;
    const enriched = await ensureLyricsForTrack(song, { persist: true });

    if (token !== lyricsLoadToken) return;
    if (!enriched || enriched.videoId !== currentLyricsSongId) return;

    currentLyricsMeta = enriched;
    currentLyricsLines = Array.isArray(enriched.lyrics?.lines) ? enriched.lyrics.lines.slice().sort((a, b) => a.time - b.time) : [];
    setLyricsLoading(false);
    renderLyricsPanel();
}

function setNowPlayingUI(song) {
    const art = getTrackCover(song);

    const title = song?.songName || song?.title || "Untitled";
    const author = song?.authorName || song?.author || "Unknown";

    if (playbackTitle) playbackTitle.textContent = title;
    if (playbackAuthor) playbackAuthor.textContent = author;

    if (albumArt) {
        setAlbumLoading(true);
        albumArt.onload = () => setAlbumLoading(false);
        albumArt.onerror = () => setAlbumLoading(false);
        albumArt.src = art || "";
        if (!art) {
            setAlbumLoading(false);
        }
    }

    if (errorMsg) {
        errorMsg.style.display = "none";
        errorMsg.innerHTML = "";
    }

    if ("mediaSession" in navigator && song) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title,
            artist: author,
            artwork: art ? [{ src: art, sizes: "300x300", type: "image/jpeg" }] : []
        });
    }

    loadLyricsForSong(song);
}

function loadNewVideo(videoId, albumArtUrl, songObject = null) {
    if (!videoId) return;

    selectedVideoId = videoId;
    actualSelectedVideoId = videoId;
    currentVideo = songObject || null;
    setAlbumLoading(true);

    const trackForUi = songObject || {
        videoId,
        songName: songObject?.songName || songObject?.title || "Untitled",
        authorName: songObject?.authorName || songObject?.author || "Unknown",
        albumArt: albumArtUrl
    };
    setNowPlayingUI(trackForUi);
    handleLastFmTrackStart(trackForUi);

    if (!player || typeof player.loadVideoById !== "function") {
        pendingVideo = { videoId, albumArtUrl, songObject };
        loadYouTubeIframeAPI();
        return;
    }

    clearTimeout(errorTimeout);
    clearInterval(countdownInterval);
    songUnavailable = false;

    player.loadVideoById(videoId);
    player.setVolume(currentVolume);

    currentTimeLabel.innerText = "00:00";
    durationLabel.innerText = "00:00";
    seekControl.value = "0";

    playing = false;
    setPlayPauseIcon(false);

    renderPlaylistView();
    updateProgressBar();
    setupMediaSession();
}

function playTrack(video) {
    const song = {
        videoId: video.videoId,
        songName: video.songName || video.title || "Untitled",
        authorName: video.authorName || video.author || "Unknown",
        albumArt: getTrackCover(video),
        duration: Number(video.duration) || 0,
        lyrics: video.lyrics || null
    };
    loadNewVideo(song.videoId, song.albumArt, song);
}

function getCurrentPlaylistSongs() {
    return getPlaylistTracksInWorkingOrder(currentPlaylist);
}

function getCurrentSongIndex() {
    const songs = getCurrentPlaylistSongs();
    if (!songs.length) return -1;
    return songs.findIndex(s => s.videoId === actualSelectedVideoId || s.videoId === selectedVideoId);
}

function playPreviousSong() {
    const songs = getCurrentPlaylistSongs();
    if (!songs.length) return;

    const currentIndex = getCurrentSongIndex();
    const prevIndex = currentIndex < 0
        ? 0
        : (currentIndex - 1 + songs.length) % songs.length;

    const prevSong = songs[prevIndex];
    actualSelectedVideoId = prevSong.videoId;
    loadNewVideo(prevSong.videoId, getTrackCover(prevSong), prevSong);
    renderPlaylistView();
}

function previousTrack() {
    playPreviousSong();
}

function nextTrack() {
    playNextSong();
}

function playNextSong() {
    const songs = getCurrentPlaylistSongs();
    if (!songs.length) return;

    const currentIndex = getCurrentSongIndex();
    const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + 1) % songs.length;

    const nextSong = songs[nextIndex];
    actualSelectedVideoId = nextSong.videoId;
    loadNewVideo(nextSong.videoId, getTrackCover(nextSong), nextSong);
    renderPlaylistView();
}

function toggleShuffle() {
    shuffleEnabled = !shuffleEnabled;
    savePlaybackStateToDB();
    if (currentPlaylist) {
        if (shuffleEnabled) {
            const working = getPlaylistTracksInWorkingOrder(currentPlaylist);
            setPlaylistWorkingOrder(currentPlaylist, shuffleArray(working), "shuffle");
        } else {
            setPlaylistToDbOrder(currentPlaylist);
        }
        syncToggleButtons();
        renderPlaylists();
        renderPlaylistView();
    } else {
        syncToggleButtons();
    }
}

function toggleRepeat() {
    repeatSong = !repeatSong;
    savePlaybackStateToDB();
    syncToggleButtons();
}

function togglePlayPause() {
    if (songUnavailable || !player) return;

    if (playing) {
        if (player.pauseVideo) player.pauseVideo();
        playing = false;
        setPlayPauseIcon(false);
        clearInterval(progressInterval);
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    } else {
        if (player.playVideo) player.playVideo();
        playing = true;
        setPlayPauseIcon(true);
        updateProgressBar();
        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    }
}

function initSeekAndVolume() {
    currentVolume = parseInt(localStorage.getItem("volumeLevel"), 10) || 80;
    volumeControl.value = currentVolume;
    if (player && player.setVolume) {
        player.setVolume(currentVolume);
    }
}

function md5cycle(x, k) {
    let [a, b, c, d] = x;

    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);

    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);

    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);

    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);
}

function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
}

function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }

function md5blk(s) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
        md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
}

function md5blkArray(a) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
        md5blks[i >> 2] = a[i] + (a[i + 1] << 8) + (a[i + 2] << 16) + (a[i + 3] << 24);
    }
    return md5blks;
}

function md51(s) {
    const n = s.length;
    let state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) {
        md5cycle(state, md5blk(s.substring(i - 64, i)));
    }
    s = s.substring(i - 64);
    const tail = new Array(16).fill(0);
    for (i = 0; i < s.length; i += 1) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
        md5cycle(state, tail);
        for (i = 0; i < 16; i += 1) tail[i] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
}

function rhex(n) {
    const s = "0123456789abcdef";
    let j;
    let out = "";
    for (j = 0; j < 4; j += 1) {
        out += s.charAt((n >> (j * 8 + 4)) & 0x0F) + s.charAt((n >> (j * 8)) & 0x0F);
    }
    return out;
}

function hex(x) {
    return x.map(rhex).join("");
}

function add32(a, b) {
    return (a + b) & 0xFFFFFFFF;
}

function md5(s) {
    return hex(md51(unescape(encodeURIComponent(s))));
}

function loadLastFmSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(LASTFM_SETTINGS_KEY) || "{}");
        return {
            username: String(raw.username || ""),
            password: String(raw.password || ""),
            permanentlyDisabled: !!raw.permanentlyDisabled,
            minListenSeconds: Math.max(1, Number(raw.minListenSeconds) || 30)
        };
    } catch {
        return {
            username: "",
            password: "",
            permanentlyDisabled: false,
            minListenSeconds: 30
        };
    }
}

function saveLastFmSettings(settings) {
    lastfmSettings = {
        username: String(settings.username || ""),
        password: String(settings.password || ""),
        permanentlyDisabled: !!settings.permanentlyDisabled,
        minListenSeconds: Math.max(1, Number(settings.minListenSeconds) || 30)
    };
    localStorage.setItem(LASTFM_SETTINGS_KEY, JSON.stringify(lastfmSettings));
    if (lastfmSettings.permanentlyDisabled) {
        lastfmTempEnabled = false;
    } else if (!localStorage.getItem(LASTFM_TEMP_ENABLED_KEY)) {
        lastfmTempEnabled = true;
    }
    localStorage.setItem(LASTFM_TEMP_ENABLED_KEY, JSON.stringify(!!lastfmTempEnabled));
    invalidateLastFmSession();
    syncLastFmToggleButton();
    startLastFmRecentTrackPolling();
    if (isLastFmEnabled()) {
        startLastFmBackgroundSync();
    } else {
        stopLastFmBackgroundSync();
    }
    renderLastFmBar();
}

function getStoredLastFmTempEnabled() {
    const raw = localStorage.getItem(LASTFM_TEMP_ENABLED_KEY);
    if (raw == null) return true;
    try {
        return !!JSON.parse(raw);
    } catch {
        return true;
    }
}

function invalidateLastFmSession() {
    lastfmSessionKey = "";
    localStorage.removeItem(LASTFM_SESSION_KEY);
}

function lastFmSignature(params) {
    const keys = Object.keys(params)
        .filter((key) => key !== "format" && key !== "api_sig" && params[key] != null && params[key] !== "")
        .sort();
    let base = "";
    for (const key of keys) {
        base += key + String(params[key]);
    }
    return md5(base + LASTFM_API_SECRET);
}

async function lastFmPost(params, { includeSignature = true } = {}) {
    const payload = { ...params, api_key: LASTFM_API_KEY, format: "json" };
    if (includeSignature) payload.api_sig = lastFmSignature(payload);

    const body = new URLSearchParams();
    Object.keys(payload).forEach((key) => {
        if (payload[key] != null && payload[key] !== "") body.append(key, String(payload[key]));
    });

    const res = await fetch(LASTFM_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body
    });

    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function isLastFmConfigured() {
    return Boolean(lastfmSettings.username && lastfmSettings.password);
}

function isLastFmEnabled() {
    return isLastFmConfigured() && !lastfmSettings.permanentlyDisabled && !!lastfmTempEnabled;
}

function syncLastFmToggleButton() {
    lastfmToggleBtn.classList.toggle("active", isLastFmEnabled());
    lastfmToggleBtn.classList.toggle("bx-radio-circle", !isLastFmEnabled());
    lastfmToggleBtn.classList.toggle("bx-radio-circle-marked", isLastFmEnabled());
    lastfmToggleBtn.title = isLastFmEnabled() ? "Disable scrobbling for now" : "Enable scrobbling for now";
}

function randomLastFmTip() {
    return LASTFM_TIPS[Math.floor(Math.random() * LASTFM_TIPS.length)] || "";
}

function renderLastFmBar(mainText = "", detailText = "") {
    if (lastfmToggleBtn) {
        lastfmToggleBtn.disabled = !isLastFmConfigured();
        syncLastFmToggleButton();
    }

    if (!isLastFmConfigured()) {
        lastfmStatus.textContent = "Last.fm not set up";
        lastfmNowPlaying.textContent = "Open Settings to save your username and password.";
        return;
    }

    if (mainText) {
        lastfmStatus.textContent = mainText;
        lastfmNowPlaying.textContent = detailText || "";
        return;
    }

    if (lastfmNowPlayingTrack) {
        lastfmStatus.textContent = "Now playing";
        lastfmNowPlaying.textContent = `${getTrackArtist(lastfmNowPlayingTrack)} — ${getTrackTitle(lastfmNowPlayingTrack)}`;
        return;
    }

    if (lastfmLastPlayedTrack) {
        lastfmStatus.textContent = "Last played";
        lastfmNowPlaying.textContent = `${getTrackArtist(lastfmLastPlayedTrack)} — ${getTrackTitle(lastfmLastPlayedTrack)}`;
        return;
    }

    lastfmStatus.textContent = "Scrobbling ready";
    lastfmNowPlaying.textContent = randomLastFmTip();
}

function setLastFmTrack(track) {
    if (!track || !track.videoId) {
        lastfmCurrentTrack = null;
        lastfmCurrentTrackSent = false;
        lastfmCurrentTrackScrobbled = false;
        clearTimeout(lastfmIdleTipTimer);
        stopLastFmBackgroundSync();
        renderLastFmBar();
        return;
    }

    lastfmCurrentTrack = {
        videoId: track.videoId,
        title: getTrackTitle(track),
        artist: getTrackArtist(track),
        album: track.album || "",
        duration: Math.max(1, Number(track.duration) || 0),
        startedAt: Date.now(),
        playStartedAt: null,
        listenedSeconds: 0
    };
    lastfmCurrentTrackSent = false;
    lastfmCurrentTrackScrobbled = false;
    clearTimeout(lastfmIdleTipTimer);
    renderLastFmBar("Scrobbling ready", `${lastfmCurrentTrack.artist} — ${lastfmCurrentTrack.title}`);
}

function getLastFmPlaybackSnapshot() {
    if (!player || typeof player.getCurrentTime !== "function") return null;
    return {
        currentTime: Math.max(0, Number(player.getCurrentTime()) || 0),
        duration: Math.max(0, Number(player.getDuration ? player.getDuration() : 0) || 0)
    };
}

function commitLastFmListenProgress({ keepRunning = false } = {}) {
    if (!lastfmCurrentTrack || !lastfmCurrentTrack.playStartedAt) return Number(lastfmCurrentTrack?.listenedSeconds) || 0;
    const delta = Math.max(0, (Date.now() - lastfmCurrentTrack.playStartedAt) / 1000);
    lastfmCurrentTrack.listenedSeconds = (Number(lastfmCurrentTrack.listenedSeconds) || 0) + delta;
    lastfmCurrentTrack.playStartedAt = keepRunning ? Date.now() : null;
    return lastfmCurrentTrack.listenedSeconds;
}

function getLastFmEffectiveListenSeconds() {
    if (!lastfmCurrentTrack) return 0;
    const base = Number(lastfmCurrentTrack.listenedSeconds) || 0;
    if (playing && lastfmCurrentTrack.playStartedAt) {
        return base + Math.max(0, (Date.now() - lastfmCurrentTrack.playStartedAt) / 1000);
    }
    return base;
}

async function syncLastFmPlayback({ sendNowPlaying = false } = {}) {
    if (!isLastFmEnabled() || !lastfmCurrentTrack || songUnavailable) return;
    if (lastfmSyncInFlight) return;
    lastfmSyncInFlight = true;
    try {
        if (playing) {
            if (!lastfmCurrentTrack.playStartedAt) {
                lastfmCurrentTrack.playStartedAt = Date.now();
            }
            if (sendNowPlaying || !lastfmCurrentTrackSent) {
                await sendLastFmNowPlaying(lastfmCurrentTrack);
            }
            const listenedSeconds = getLastFmEffectiveListenSeconds();
            if (!lastfmCurrentTrackScrobbled && listenedSeconds >= getLastFmScrobbleThreshold()) {
                commitLastFmListenProgress({ keepRunning: true });
                await sendLastFmScrobble(lastfmCurrentTrack, Math.floor((lastfmCurrentTrack.startedAt || Date.now()) / 1000));
            }
        } else {
            commitLastFmListenProgress();
        }
    } finally {
        lastfmSyncInFlight = false;
        renderLastFmBar();
    }
}

async function finalizeLastFmCurrentTrack() {
    if (!lastfmCurrentTrack) return;
    const finishedTrack = {
        ...lastfmCurrentTrack,
        listenedSeconds: getLastFmEffectiveListenSeconds(),
        playStartedAt: null
    };
    commitLastFmListenProgress();
    if (isLastFmEnabled() && finishedTrack.listenedSeconds >= getLastFmScrobbleThreshold()) {
        await sendLastFmScrobble(finishedTrack, Math.floor((finishedTrack.startedAt || Date.now()) / 1000), { markCurrent: false });
    }
}

function startLastFmBackgroundSync() {
    stopLastFmBackgroundSync();
    if (!isLastFmEnabled() || !lastfmCurrentTrack || songUnavailable) {
        renderLastFmBar();
        return;
    }
    lastfmSyncTimer = setInterval(() => {
        void syncLastFmPlayback();
    }, Math.max(1, Number(lastfmSettings.minListenSeconds) || 30) * 1000);
    void syncLastFmPlayback({ sendNowPlaying: true });
}

function stopLastFmBackgroundSync() {
    if (lastfmSyncTimer) {
        clearInterval(lastfmSyncTimer);
        lastfmSyncTimer = null;
    }
}

async function ensureLastFmSession(force = false) {

    if (!isLastFmConfigured() || lastfmSettings.permanentlyDisabled) return null;
    if (lastfmSessionKey && !force) return lastfmSessionKey;

    if (lastfmAuthPromise && !force) return lastfmAuthPromise;

    const payload = {
        method: "auth.getMobileSession",
        username: lastfmSettings.username,
        password: lastfmSettings.password,
        api_key: LASTFM_API_KEY
    };
    payload.api_sig = lastFmSignature(payload);

    lastfmAuthPromise = lastFmPost(payload, { includeSignature: false })
        .then((data) => {
            const sessionKey = data?.session?.key || "";
            if (!sessionKey) throw new Error("Last.fm auth failed");
            lastfmSessionKey = sessionKey;
            localStorage.setItem(LASTFM_SESSION_KEY, sessionKey);
            return sessionKey;
        })
        .finally(() => {
            lastfmAuthPromise = null;
        });

    return lastfmAuthPromise;
}

async function sendLastFmNowPlaying(track) {
    if (!isLastFmEnabled() || !track || !track.title) return;
    try {
        const sk = await ensureLastFmSession();
        if (!sk) return;

        const payload = {
            method: "track.updateNowPlaying",
            sk,
            artist: track.artist,
            track: track.title,
            album: track.album || "",
            duration: Math.max(1, Number(track.duration) || 0),
            api_key: LASTFM_API_KEY
        };
        payload.api_sig = lastFmSignature(payload);

        await lastFmPost(payload, { includeSignature: false });
        lastfmCurrentTrackSent = true;
    } catch {
        invalidateLastFmSession();
    }
}

async function sendLastFmScrobble(track, timestamp, { markCurrent = true } = {}) {
    if (!isLastFmEnabled() || !track || !track.title || lastfmScrobbleInFlight) return;
    if (markCurrent && lastfmCurrentTrackScrobbled) return;
    if (markCurrent && lastfmCurrentTrack && track.videoId && lastfmCurrentTrack.videoId !== track.videoId) return;
    lastfmScrobbleInFlight = true;
    try {
        const sk = await ensureLastFmSession();
        if (!sk) return;

        const payload = {
            method: "track.scrobble",
            sk,
            artist: track.artist,
            track: track.title,
            album: track.album || "",
            duration: Math.max(1, Number(track.duration) || 0),
            timestamp: Math.max(1, Number(timestamp) || Math.floor(Date.now() / 1000)),
            chosenByUser: 1,
            api_key: LASTFM_API_KEY
        };
        payload.api_sig = lastFmSignature(payload);

        await lastFmPost(payload, { includeSignature: false });
        if (markCurrent) {
            lastfmCurrentTrackScrobbled = true;
            renderLastFmBar("Scrobbled", `${track.artist} — ${track.title}`);
        }
    } catch {
        invalidateLastFmSession();
    } finally {
        lastfmScrobbleInFlight = false;
    }
}

async function refreshLastFmRecentTrack() {
    if (!isLastFmConfigured()) return;
    try {
        const url = `${LASTFM_API_URL}/?method=user.getRecentTracks&user=${encodeURIComponent(lastfmSettings.username)}&limit=2&api_key=${encodeURIComponent(LASTFM_API_KEY)}&format=json`;
        const data = await fetch(url).then((r) => r.json());
        const track = data?.recenttracks?.track;
        const items = Array.isArray(track) ? track : (track ? [track] : []);

        if (!items.length) {
            lastfmNowPlayingTrack = null;
            lastfmLastPlayedTrack = null;
            lastfmLastRecentTrackText = "";
            renderLastFmBar();
            return;
        }

        const nowPlayingItem = items.find((item) => item?.["@attr"]?.nowplaying === "true") || null;
        const recentItem = items.find((item) => item !== nowPlayingItem && item?.name) || null;

        lastfmNowPlayingTrack = nowPlayingItem ? normalizeLastFmRecentTrack(nowPlayingItem) : null;
        lastfmLastPlayedTrack = recentItem ? normalizeLastFmRecentTrack(recentItem) : null;

        if (!lastfmLastPlayedTrack && lastfmNowPlayingTrack) {
            lastfmLastPlayedTrack = lastfmNowPlayingTrack;
        }

        if (lastfmNowPlayingTrack) {
            lastfmLastRecentTrackText = `Now playing on Last.fm: ${getTrackArtist(lastfmNowPlayingTrack)} — ${getTrackTitle(lastfmNowPlayingTrack)}`;
        } else if (lastfmLastPlayedTrack) {
            lastfmLastRecentTrackText = `Last played on Last.fm: ${getTrackArtist(lastfmLastPlayedTrack)} — ${getTrackTitle(lastfmLastPlayedTrack)}`;
        } else {
            lastfmLastRecentTrackText = "";
        }

        renderLastFmBar();
    } catch {
        renderLastFmBar();
    }
}

function startLastFmRecentTrackPolling() {
    stopLastFmRecentTrackPolling();
    if (!isLastFmConfigured()) return;
    void refreshLastFmRecentTrack();
    lastfmRecentTrackTimer = setInterval(() => {
        void refreshLastFmRecentTrack();
    }, Math.max(1, Number(lastfmSettings.minListenSeconds) || 30) * 1000);
}

function stopLastFmRecentTrackPolling() {
    if (lastfmRecentTrackTimer) {
        clearInterval(lastfmRecentTrackTimer);
        lastfmRecentTrackTimer = null;
    }
}

function toggleLastFmScrobbling() {
    if (!isLastFmConfigured()) {
        openSettingsModal();
        return;
    }
    lastfmTempEnabled = !isLastFmEnabled();
    localStorage.setItem(LASTFM_TEMP_ENABLED_KEY, JSON.stringify(!!lastfmTempEnabled));
    syncLastFmToggleButton();
    renderLastFmBar();
    if (lastfmTempEnabled) {
        startLastFmBackgroundSync();
        if (lastfmCurrentTrack && playing) {
            void syncLastFmPlayback({ sendNowPlaying: true });
        }
    } else {
        stopLastFmBackgroundSync();
    }
    renderLastFmBar();
}

function loadLastFmSettingsIntoModal() {
    usernameInput.value = lastfmSettings.username || "";
    passwordInput.value = lastfmSettings.password || "";
    minListenInput.value = String(Math.max(1, Number(lastfmSettings.minListenSeconds) || 30));
    permanentDisableInput.checked = !!lastfmSettings.permanentlyDisabled;
}

function saveSettings() {
    const nextSettings = {
        username: usernameInput ? usernameInput.value.trim() : lastfmSettings.username,
        password: passwordInput ? passwordInput.value : lastfmSettings.password,
        minListenSeconds: minListenInput ? Number(minListenInput.value) || 30 : lastfmSettings.minListenSeconds,
        permanentlyDisabled: permanentDisableInput ? !!permanentDisableInput.checked : lastfmSettings.permanentlyDisabled
    };

    saveLastFmSettings(nextSettings);
    if (!nextSettings.permanentlyDisabled && lastfmTempEnabled) {
        void ensureLastFmSession(true);
    }

    closeSettingsModal();
}

function openSettingsModal() {
    loadLastFmSettingsIntoModal();
    settingsModal.style.display = "flex";
}

function closeSettingsModal() {
    settingsModal.style.display = "none";
}

function getLastFmScrobbleThreshold() {
    return Math.max(1, Number(lastfmSettings.minListenSeconds) || 30);
}

function handleLastFmTrackStart(track) {
    if (lastfmCurrentTrack && lastfmCurrentTrack.videoId && track && lastfmCurrentTrack.videoId !== track.videoId) {
        void finalizeLastFmCurrentTrack();
    }
    setLastFmTrack(track);
    if (isLastFmEnabled() && lastfmCurrentTrack) {
        startLastFmBackgroundSync();
    } else {
        renderLastFmBar();
    }
}

function handleLastFmPlaybackStarted() {
    if (isLastFmEnabled() && lastfmCurrentTrack) {
        if (!lastfmCurrentTrack.playStartedAt) {
            lastfmCurrentTrack.playStartedAt = Date.now();
        }
        startLastFmBackgroundSync();
        void syncLastFmPlayback({ sendNowPlaying: true });
    }
    renderLastFmBar();
}

function handleLastFmPlaybackPaused() {
    commitLastFmListenProgress();
    stopLastFmBackgroundSync();
    renderLastFmBar();
}

function handleLastFmPlaybackEnded() {
    commitLastFmListenProgress();
    stopLastFmBackgroundSync();
    if (isLastFmEnabled() && lastfmCurrentTrack && !lastfmCurrentTrackScrobbled) {
        void syncLastFmPlayback();
    }
    renderLastFmBar();
}

function handleLastFmProgress(currentTime, duration) {
    if (!isLastFmEnabled() || !lastfmCurrentTrack || songUnavailable) return;
    lastfmCurrentTrack.duration = Math.max(1, Number(duration) || lastfmCurrentTrack.duration || 0);

    if (!lastfmCurrentTrackSent && playing) {
        void sendLastFmNowPlaying(lastfmCurrentTrack);
    }

    if (!lastfmCurrentTrackScrobbled && getLastFmEffectiveListenSeconds() >= getLastFmScrobbleThreshold()) {
        void syncLastFmPlayback();
    }
}

document.addEventListener("DOMContentLoaded", function () {
    document.body.style.opacity = "1";
    const db = getDB();
    const state = db && typeof db.playerState === "object" ? db.playerState : {};
    repeatSong: !!state.repeatSong,
    syncToggleButtons();
    savePlaybackStateToDB();
    setAlbumLoading(false);
    setLyricsLoading(false);
    renderPlaylists();
    renderPlaylistView();
    setupMediaSession();
    initSeekAndVolume();
    syncLastFmToggleButton();
    renderLastFmBar();
    startLastFmRecentTrackPolling();
    if (isLastFmConfigured() && isLastFmEnabled()) {
        startLastFmBackgroundSync();
        void ensureLastFmSession();
    }

    const names = Object.keys(db.playlists);
    if (names.length && db.playlists[names[0]].length) {
        currentPlaylist = names[0];
        const firstSong = db.playlists[names[0]][0];
        actualSelectedVideoId = firstSong.videoId;
        selectedVideoId = firstSong.videoId;
        setNowPlayingUI(firstSong);
        handleLastFmTrackStart(firstSong);
        renderPlaylistView();
    } else {
        renderLyricsPanel();
        renderLastFmBar();
    }
});
