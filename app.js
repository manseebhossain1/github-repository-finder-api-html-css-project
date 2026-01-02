

// grab all the HTML elements we need to update later
const els = {
  languageSelect: document.getElementById("languageSelect"), // <select> dropdown
  fetchBtn: document.getElementById("fetchBtn"),             // main "Find" button
  refreshBtn: document.getElementById("refreshBtn"),         // refresh button (hidden at first)
  status: document.getElementById("status"),                 // status text area (loading/error/etc)
  card: document.getElementById("card"),                     // repo card container

  repoName: document.getElementById("repoName"),             // where repo name goes
  repoLink: document.getElementById("repoLink"),             // link to GitHub repo
  repoDesc: document.getElementById("repoDesc"),             // repo description

  stars: document.getElementById("stars"),                   // stars number
  forks: document.getElementById("forks"),                   // forks number
  issues: document.getElementById("issues"),                 // open issues number

  languageChip: document.getElementById("languageChip"),     // chip showing language
  ownerChip: document.getElementById("ownerChip")            // chip showing owner
};

// optional token if you run into GitHub rate limits (leave blank for class project)
const GITHUB_TOKEN = "";

// used to cancel an old request if the user clicks again quickly
let currentAbort = null;

// put a message in the status area (and make it red if it's an error)
function setStatus(message, type = "info") {
  els.status.textContent = message || ""; // show message, or clear it if empty

  if (type === "error") {
    els.status.style.color = "var(--danger)"; // red (defined in CSS)
  } else {
    els.status.style.color = ""; // default color from CSS
  }
}

// show/hide the repo card by toggling the "hidden" class
function showCard(show) {
  els.card.classList.toggle("hidden", !show);
}

// show/hide the refresh button
function showRefresh(show) {
  els.refreshBtn.classList.toggle("hidden", !show);
}

// disable UI controls during loading so user can't spam clicks / change language mid-request
function setLoading(isLoading) {
  els.fetchBtn.disabled = isLoading;
  els.refreshBtn.disabled = isLoading;
  els.languageSelect.disabled = isLoading;
}

// fill the dropdown using the LANGUAGES array from languages.js
function populateLanguages() {
  const langs = window.LANGUAGES || []; // languages.js sets window.LANGUAGES = [...]
  els.languageSelect.innerHTML = "";    // clear existing options

  for (const lang of langs) {
    const opt = document.createElement("option"); // create <option>
    opt.value = lang;                             // value behind the scenes
    opt.textContent = lang;                       // text user sees
    els.languageSelect.appendChild(opt);          // add to dropdown
  }
}

// build headers for the GitHub API request (add Authorization if token exists)
function headers() {
  const h = { "Accept": "application/vnd.github+json" };

  if (GITHUB_TOKEN) {
    h["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  }

  return h;
}

// helper: random integer between min and max (inclusive)
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/*
  fetchRandomRepo(language)

  goal: pick a random repo for a given language using GitHub Search API

  approach:
  1) do a quick request to get total_count
  2) pick a random page (capped because search only lets you access first ~1000 results)
  3) request that page with 100 results
  4) pick a random repo from those results
*/
async function fetchRandomRepo(language) {
  // cancel any previous request so old results don't overwrite new ones
  if (currentAbort) currentAbort.abort();

  // make a new abort controller for this request
  currentAbort = new AbortController();

  const base = "https://api.github.com/search/repositories";

  // build query: filter by language, minimum stars, and not archived
  const q = `language:${language} stars:>=50 archived:false`;
  const encodedQ = encodeURIComponent(q); // make it URL safe

  // step 1: ask for 1 item just to get total_count
  const urlCount = `${base}?q=${encodedQ}&per_page=1`;

  const resCount = await fetch(urlCount, {
    headers: headers(),
    signal: currentAbort.signal
  });

  if (!resCount.ok) {
    throw await toGitHubError(resCount);
  }

  const dataCount = await resCount.json();
  const total = dataCount.total_count || 0;

  // no results => return null (empty state)
  if (total === 0) return null;

  // cap pages to 10 (because 10 pages * 100 results/page = first 1000 results)
  const maxPages = Math.min(10, Math.ceil(total / 100));
  const page = randomInt(1, maxPages);

  // step 2: fetch a page of repos (100 at a time)
  const urlPage = `${base}?q=${encodedQ}&sort=stars&order=desc&per_page=100&page=${page}`;

  const resPage = await fetch(urlPage, {
    headers: headers(),
    signal: currentAbort.signal
  });

  if (!resPage.ok) {
    throw await toGitHubError(resPage);
  }

  const dataPage = await resPage.json();
  const items = dataPage.items || [];

  if (items.length === 0) return null;

  // pick a random repo from the page
  return items[randomInt(0, items.length - 1)];
}

// tries to convert a GitHub error response into a nicer error message
async function toGitHubError(response) {
  let msg = `Request failed (${response.status})`;

  try {
    const body = await response.json();
    if (body?.message) msg = body.message;
    if (body?.documentation_url) msg += ` — ${body.documentation_url}`;
  } catch {
    // if response isn't JSON, just keep default msg
  }

  return new Error(msg);
}

// takes a repo object (from GitHub) and fills in the HTML
function renderRepo(repo) {
  els.repoName.textContent = repo.full_name || repo.name || "Unknown repo";
  els.repoLink.href = repo.html_url || "#";
  els.repoDesc.textContent = repo.description || "No description provided.";

  // numbers (use ?? 0 in case field is missing)
  els.stars.textContent = (repo.stargazers_count ?? 0).toLocaleString();
  els.forks.textContent = (repo.forks_count ?? 0).toLocaleString();
  els.issues.textContent = (repo.open_issues_count ?? 0).toLocaleString();

  // extra info chips
  els.languageChip.textContent = repo.language
    ? `Language: ${repo.language}`
    : "Language: (unknown)";

  els.ownerChip.textContent = repo.owner?.login
    ? `Owner: ${repo.owner.login}`
    : "Owner: (unknown)";
}

// main function that runs on button clicks
// sets loading UI, fetches repo, then shows success/empty/error UI
async function run(mode = "fetch") {
  const language = els.languageSelect.value;

  // reset UI for a new request
  setLoading(true);
  showCard(false);
  showRefresh(false);
  setStatus("Loading…");

  try {
    const repo = await fetchRandomRepo(language);

    if (!repo) {
      setStatus(`No repositories found for "${language}". Try another language.`);
      return;
    }

    // success
    renderRepo(repo);
    setStatus("");
    showCard(true);
    showRefresh(true);
  } catch (err) {
    // if we canceled the request, don't show an error
    if (err.name === "AbortError") return;

    setStatus(`Error: ${err.message}`, "error");
  } finally {
    // always re-enable UI
    setLoading(false);
  }
}

// set up the app once the script loads
function init() {
  populateLanguages();

  els.fetchBtn.addEventListener("click", () => run("fetch"));
  els.refreshBtn.addEventListener("click", () => run("refresh"));

  // could auto-run on page load if you want
  // run("fetch");
}

// start everything
init();
