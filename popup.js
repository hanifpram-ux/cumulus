document.getElementById("open-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("manager.html") });
  window.close();
});
