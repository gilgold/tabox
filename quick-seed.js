// Quick Test Data Seeder - Paste this into browser console
// This will load the full seeder and run it automatically

console.log('🌱 Loading Tabox Test Data Seeder...');

// Mini version for quick testing (generates 25 collections)
const quickSeed = async () => {
  if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
    window.browser = chrome;
  }
  
  if (typeof browser === 'undefined') {
    console.error('❌ Run this in the extension context (popup or options page)');
    return;
  }

  console.log('🎯 Generating quick test data (25 collections)...');
  
  const sites = [
    { url: "https://github.com/user/repo", title: "GitHub Repository" },
    { url: "https://stackoverflow.com/questions/123", title: "Stack Overflow Question" },
    { url: "https://docs.google.com/document/d/123", title: "Google Docs" },
    { url: "https://figma.com/file/123", title: "Figma Design" },
    { url: "https://notion.so/page", title: "Notion Page" },
    { url: "https://youtube.com/watch?v=123", title: "YouTube Video" },
    { url: "https://reddit.com/r/programming", title: "Reddit Programming" },
    { url: "https://twitter.com/user", title: "Twitter Profile" }
  ];

  const generateQuickCollection = (i) => {
    const numTabs = Math.floor(Math.random() * 15) + 5;
    const tabs = [];
    
    for (let j = 0; j < numTabs; j++) {
      const site = sites[Math.floor(Math.random() * sites.length)];
      tabs.push({
        uid: `tab_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        title: site.title,
        url: site.url,
        pinned: Math.random() < 0.2,
        mutedInfo: { muted: Math.random() < 0.3 },
        audible: Math.random() < 0.1,
        index: j,
        id: Math.floor(Math.random() * 9999) + 1000
      });
    }

    return {
      uid: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `Test Collection ${i + 1}`,
      tabs: tabs,
      chromeGroups: [],
      type: "collection",
      createdOn: Date.now() - (Math.random() * 30 * 24 * 60 * 60 * 1000),
      lastUpdated: Date.now(),
      color: ['blue', 'red', 'green', 'yellow', 'purple'][Math.floor(Math.random() * 5)]
    };
  };

  const collections = [];
  for (let i = 0; i < 25; i++) {
    collections.push(generateQuickCollection(i));
  }

  const testData = { tabsArray: collections, localTimestamp: Date.now() };
  const size = JSON.stringify(testData).length / (1024 * 1024);
  
  console.log(`📏 Data size: ${size.toFixed(2)}MB`);
  
  await browser.storage.local.set(testData);
  
  const totalTabs = collections.reduce((sum, col) => sum + col.tabs.length, 0);
  const pinnedTabs = collections.reduce((sum, col) => 
    sum + col.tabs.filter(tab => tab.pinned).length, 0);
  
  console.log(`✅ Generated 25 collections with ${totalTabs} tabs (${pinnedTabs} pinned)`);
  console.log('🔄 Refresh the extension to see the data!');
  
  return { collections: 25, tabs: totalTabs, sizeMB: size };
};

// Make it available globally
window.quickSeed = quickSeed;

console.log('✅ Quick seeder loaded!');
console.log('💡 Run: await quickSeed()');
console.log('');
console.log('📝 Available commands:');
console.log('   await quickSeed() - Generate 25 test collections');
console.log('   await clearTestData() - Clear all data (if full seeder was loaded)');

// Auto-run quick seed
setTimeout(async () => {
  console.log('🚀 Auto-running quick seed in 2 seconds...');
  console.log('💡 Press Ctrl+C to cancel');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await quickSeed();
}, 100); 