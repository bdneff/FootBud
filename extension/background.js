// FootBud ESPN draft bridge: relay picks from the ESPN draft room content
// script to every tab that might be running FootBud.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'footbud-picks') return;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined || tab.id === sender.tab?.id) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tab without the FootBud content script; ignore.
      });
    }
  });
});
