// ====================================================================
// TABOX TEST DATA SEEDER - STANDALONE CONSOLE VERSION
// ====================================================================
// Copy and paste this ENTIRE script into your browser console
// while the Tabox extension popup is open
// ====================================================================

(function() {
  'use strict';
  
  console.log('🌱 Loading Tabox Test Data Seeder (Standalone)...');

  // Check browser context
  if (typeof window === 'undefined') {
    console.error('❌ This script must be run in a browser context');
    return;
  }

  // Browser API compatibility
  if (typeof browser === 'undefined' && typeof chrome !== 'undefined') {
    window.browser = chrome;
  }

  if (typeof browser === 'undefined') {
    console.error('❌ Browser extension API not available. Make sure you are running this in the extension context (popup or options page).');
    return;
  }

  // Sample realistic websites and categories
  const SAMPLE_SITES = {
    work: [
      { url: "https://github.com/username/project", title: "GitHub - Project Repository" },
      { url: "https://stackoverflow.com/questions/12345", title: "javascript - How to optimize performance" },
      { url: "https://docs.google.com/document/d/abc123", title: "Project Requirements - Google Docs" },
      { url: "https://slack.com/app", title: "Slack - Team Communication" },
      { url: "https://trello.com/b/abc123", title: "Project Board - Trello" },
      { url: "https://figma.com/file/abc123", title: "UI Design - Figma" },
      { url: "https://linear.app/team/issue/ABC-123", title: "Bug Fix - Linear" },
      { url: "https://notion.so/workspace/page123", title: "Team Wiki - Notion" },
      { url: "https://calendar.google.com", title: "Google Calendar" },
      { url: "https://mail.google.com", title: "Gmail" }
    ],
    research: [
      { url: "https://arxiv.org/abs/2301.12345", title: "Machine Learning Research Paper" },
      { url: "https://scholar.google.com/scholar?q=ai", title: "Google Scholar - AI Research" },
      { url: "https://www.nature.com/articles/article123", title: "Nature - Scientific Article" },
      { url: "https://en.wikipedia.org/wiki/Artificial_intelligence", title: "Artificial Intelligence - Wikipedia" },
      { url: "https://paperswithcode.com/task/image-classification", title: "Papers With Code - Image Classification" },
      { url: "https://huggingface.co/models", title: "Hugging Face - Models" },
      { url: "https://openai.com/research", title: "OpenAI Research" },
      { url: "https://deepmind.com/research", title: "DeepMind Research" }
    ],
    shopping: [
      { url: "https://amazon.com/dp/B08ABC123", title: "MacBook Pro 16-inch - Amazon" },
      { url: "https://ebay.com/itm/123456789", title: "Vintage Camera - eBay" },
      { url: "https://etsy.com/listing/123456", title: "Handmade Jewelry - Etsy" },
      { url: "https://shopify.com/store/abc", title: "Online Store - Shopify" },
      { url: "https://target.com/p/product123", title: "Home Decor - Target" },
      { url: "https://walmart.com/ip/123456", title: "Electronics - Walmart" },
      { url: "https://bestbuy.com/site/product/123456", title: "Gaming Laptop - Best Buy" }
    ],
    social: [
      { url: "https://twitter.com/username", title: "User Profile - Twitter" },
      { url: "https://reddit.com/r/programming", title: "r/programming - Reddit" },
      { url: "https://linkedin.com/in/username", title: "Professional Profile - LinkedIn" },
      { url: "https://instagram.com/username", title: "Photo Gallery - Instagram" },
      { url: "https://youtube.com/watch?v=abc123", title: "Tutorial Video - YouTube" },
      { url: "https://discord.com/channels/123/456", title: "Community Chat - Discord" },
      { url: "https://facebook.com/groups/123", title: "Developer Group - Facebook" }
    ],
    entertainment: [
      { url: "https://netflix.com/watch/123456", title: "Movie Title - Netflix" },
      { url: "https://spotify.com/playlist/abc123", title: "Coding Playlist - Spotify" },
      { url: "https://twitch.tv/streamer", title: "Live Stream - Twitch" },
      { url: "https://imdb.com/title/tt123456", title: "Movie Details - IMDb" },
      { url: "https://steam.com/app/123456", title: "Indie Game - Steam" },
      { url: "https://itch.io/games/abc123", title: "Game Development - itch.io" }
    ],
    news: [
      { url: "https://techcrunch.com/2024/01/01/article", title: "Latest Tech News - TechCrunch" },
      { url: "https://hackernews.com/item?id=123456", title: "Discussion - Hacker News" },
      { url: "https://wired.com/story/article-title", title: "Technology Article - Wired" },
      { url: "https://theverge.com/2024/1/1/article", title: "Product Review - The Verge" },
      { url: "https://arstechnica.com/tech-policy/article", title: "Tech Policy - Ars Technica" },
      { url: "https://reuters.com/technology/article", title: "Tech News - Reuters" }
    ]
  };

  // Tab group colors and names
  const TAB_GROUPS = [
    { name: "Research", color: "blue" },
    { name: "Work", color: "red" },
    { name: "Shopping", color: "green" },
    { name: "Social", color: "yellow" },
    { name: "Documentation", color: "purple" },
    { name: "Design", color: "pink" },
    { name: "Development", color: "cyan" },
    { name: "Testing", color: "orange" },
    { name: "Meetings", color: "grey" },
    { name: "Resources", color: "blue" },
    { name: "Tutorials", color: "green" },
    { name: "References", color: "red" }
  ];

  // Collection name templates
  const COLLECTION_TEMPLATES = [
    "Project {name} - Week {week}",
    "{category} Research - {month} 2024",
    "Sprint {number} - {team} Team",
    "{category} Resources & Tools",
    "Meeting Notes - {topic}",
    "Client Work - {client}",
    "Learning {subject}",
    "{category} Bookmarks",
    "Weekend Project - {name}",
    "Conference Notes - {event}",
    "Bug Investigation - {issue}",
    "Design System - {component}",
    "Performance Optimization",
    "Code Review - {feature}",
    "Documentation Update"
  ];

  // Utility functions
  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randomChoice = (array) => array[Math.floor(Math.random() * array.length)];
  const randomBoolean = (probability = 0.5) => Math.random() < probability;

  const generateUID = () => {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  const generateTabUID = () => {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  };

  const generateGroupUID = () => {
    return `group_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  };

  // Generate a realistic tab
  const generateTab = (category, groupId = null) => {
    const sites = SAMPLE_SITES[category] || SAMPLE_SITES.work;
    const site = randomChoice(sites);
    
    const tab = {
      uid: generateTabUID(),
      title: site.title,
      url: site.url,
      favIconUrl: `https://www.google.com/s2/favicons?domain=${new URL(site.url).hostname}`,
      index: randomInt(0, 20),
      windowId: randomInt(1, 5),
      highlighted: randomBoolean(0.1),
      active: randomBoolean(0.05),
      pinned: randomBoolean(0.15),
      audible: randomBoolean(0.1),
      discarded: randomBoolean(0.2),
      autoDiscardable: randomBoolean(0.8),
      mutedInfo: {
        muted: randomBoolean(0.3)
      },
      id: randomInt(1000, 9999)
    };

    if (groupId) {
      tab.groupUid = groupId;
    }

    return tab;
  };

  // Generate tab group
  const generateTabGroup = () => {
    const group = randomChoice(TAB_GROUPS);
    return {
      uid: generateGroupUID(),
      name: group.name,
      color: group.color,
      collapsed: randomBoolean(0.3),
      id: randomInt(100, 999),
      windowId: randomInt(1, 5)
    };
  };

  // Generate a collection
  const generateCollection = (index) => {
    const categories = Object.keys(SAMPLE_SITES);
    const category = randomChoice(categories);
    
    // Generate collection name
    const template = randomChoice(COLLECTION_TEMPLATES);
    const name = template
      .replace('{name}', randomChoice(['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega']))
      .replace('{week}', randomInt(1, 52))
      .replace('{category}', category.charAt(0).toUpperCase() + category.slice(1))
      .replace('{month}', randomChoice(['January', 'February', 'March', 'April', 'May', 'June']))
      .replace('{number}', randomInt(1, 20))
      .replace('{team}', randomChoice(['Frontend', 'Backend', 'DevOps', 'Design', 'QA']))
      .replace('{topic}', randomChoice(['Planning', 'Review', 'Retrospective', 'Demo']))
      .replace('{client}', randomChoice(['Acme Corp', 'Tech Solutions', 'Digital Agency', 'StartupXYZ']))
      .replace('{subject}', randomChoice(['React', 'Node.js', 'Python', 'Machine Learning', 'WebGL']))
      .replace('{event}', randomChoice(['DevConf', 'TechSummit', 'CodeCamp', 'WebExpo']))
      .replace('{issue}', `#${randomInt(100, 999)}`)
      .replace('{component}', randomChoice(['Button', 'Modal', 'Table', 'Form', 'Navigation']))
      .replace('{feature}', randomChoice(['Authentication', 'Search', 'Dashboard', 'Analytics']));

    // Generate tabs and groups
    const numTabs = randomInt(3, 25);
    const useGroups = randomBoolean(0.6);
    const groups = [];
    const tabs = [];

    if (useGroups) {
      const numGroups = randomInt(1, 4);
      for (let i = 0; i < numGroups; i++) {
        groups.push(generateTabGroup());
      }
    }

    // Generate tabs
    for (let i = 0; i < numTabs; i++) {
      const shouldBeInGroup = useGroups && groups.length > 0 && randomBoolean(0.7);
      const groupId = shouldBeInGroup ? randomChoice(groups).uid : null;
      tabs.push(generateTab(category, groupId));
    }

    // Separate pinned tabs from regular tabs and ensure pinned tabs are not in groups
    const pinnedTabs = [];
    const regularTabs = [];
    
    tabs.forEach(tab => {
      if (tab.pinned) {
        // Remove group assignment from pinned tabs
        delete tab.groupUid;
        pinnedTabs.push(tab);
      } else {
        regularTabs.push(tab);
      }
    });

    // Pinned tabs go first, then regular tabs
    const orderedTabs = [...pinnedTabs, ...regularTabs];
    
    // Update tab indices to reflect their final position
    orderedTabs.forEach((tab, index) => {
      tab.index = index;
    });

    // Add creation and update timestamps
    const createdDaysAgo = randomInt(1, 365);
    const createdOn = Date.now() - (createdDaysAgo * 24 * 60 * 60 * 1000);
    const lastUpdated = createdOn + randomInt(0, createdDaysAgo * 24 * 60 * 60 * 1000);

    return {
      uid: generateUID(),
      name: name,
      tabs: orderedTabs,
      chromeGroups: groups,
      type: "collection",
      createdOn: createdOn,
      lastUpdated: lastUpdated,
      color: randomChoice(['blue', 'red', 'green', 'yellow', 'purple', 'pink', 'cyan', 'orange', 'grey']),
      window: {
        id: randomInt(1, 5),
        incognito: randomBoolean(0.1),
        type: "normal",
        state: randomChoice(["normal", "maximized", "minimized"]),
        alwaysOnTop: randomBoolean(0.05),
        focused: randomBoolean(0.2)
      }
    };
  };

  // Main seeding function for large datasets
  const seedTestData = async (count = null) => {
    console.log('🌱 Starting test data seeding...');
    
    try {
      // Get current storage stats
      const currentData = await browser.storage.local.get();
      const currentSize = JSON.stringify(currentData).length / (1024 * 1024);
      console.log(`📊 Current storage: ${currentSize.toFixed(2)}MB`);

      // Generate collections
      const numCollections = count || randomInt(150, 200);
      console.log(`🎯 Generating ${numCollections} collections...`);
      
      const collections = [];
      for (let i = 0; i < numCollections; i++) {
        collections.push(generateCollection(i));
        if ((i + 1) % 25 === 0) {
          console.log(`📦 Generated ${i + 1}/${numCollections} collections...`);
        }
      }

      // Calculate final size
      const testData = { tabsArray: collections, localTimestamp: Date.now() };
      const finalSize = JSON.stringify(testData).length / (1024 * 1024);
      console.log(`📏 Generated data size: ${finalSize.toFixed(2)}MB`);

      // Store data
      console.log('💾 Storing test data...');
      await browser.storage.local.set(testData);
      
      // Verify storage
      const verification = await browser.storage.local.get('tabsArray');
      console.log(`✅ Successfully stored ${verification.tabsArray.length} collections!`);
      
      // Generate summary report
      const totalTabs = collections.reduce((sum, col) => sum + col.tabs.length, 0);
      const totalGroups = collections.reduce((sum, col) => sum + col.chromeGroups.length, 0);
      const pinnedTabs = collections.reduce((sum, col) => 
        sum + col.tabs.filter(tab => tab.pinned).length, 0);
      const mutedTabs = collections.reduce((sum, col) => 
        sum + col.tabs.filter(tab => tab.mutedInfo?.muted).length, 0);
      const groupedTabs = collections.reduce((sum, col) => 
        sum + col.tabs.filter(tab => tab.groupUid).length, 0);

      console.log('\n📊 TEST DATA SUMMARY:');
      console.log(`   Collections: ${collections.length}`);
      console.log(`   Total Tabs: ${totalTabs}`);
      console.log(`   Tab Groups: ${totalGroups}`);
      console.log(`   Pinned Tabs: ${pinnedTabs} (always first, never in groups)`);
      console.log(`   Muted Tabs: ${mutedTabs}`);
      console.log(`   Grouped Tabs: ${groupedTabs}`);
      console.log(`   Data Size: ${finalSize.toFixed(2)}MB`);
      
      // Test storage performance
      console.log('\n⚡ Testing storage performance...');
      const startTime = Date.now();
      const reloadData = await browser.storage.local.get('tabsArray');
      const loadTime = Date.now() - startTime;
      console.log(`   Load time: ${loadTime}ms`);
      
      if (finalSize > 2) {
        console.log('\n⚠️  Large dataset detected - perfect for testing storage optimization!');
      }
      
      console.log('\n🔄 Refresh the extension to see the new data!');
      
      return {
        collections: collections.length,
        tabs: totalTabs,
        groups: totalGroups,
        sizeMB: finalSize,
        loadTimeMs: loadTime
      };

    } catch (error) {
      console.error('❌ Error seeding test data:', error);
      return null;
    }
  };

  // Quick seeding function for smaller datasets
  const quickSeed = async (count = 25) => {
    console.log(`🎯 Generating quick test data (${count} collections)...`);
    
    const collections = [];
    for (let i = 0; i < count; i++) {
      collections.push(generateCollection(i));
    }

    const testData = { tabsArray: collections, localTimestamp: Date.now() };
    const size = JSON.stringify(testData).length / (1024 * 1024);
    
    console.log(`📏 Data size: ${size.toFixed(2)}MB`);
    
    await browser.storage.local.set(testData);
    
    const totalTabs = collections.reduce((sum, col) => sum + col.tabs.length, 0);
    const pinnedTabs = collections.reduce((sum, col) => 
      sum + col.tabs.filter(tab => tab.pinned).length, 0);
    
    console.log(`✅ Generated ${count} collections with ${totalTabs} tabs (${pinnedTabs} pinned, always first)`);
    console.log('🔄 Refresh the extension to see the data!');
    
    return { collections: count, tabs: totalTabs, sizeMB: size };
  };

  // Cleanup function
  const clearTestData = async () => {
    console.log('🧹 Clearing test data...');
    
    try {
      await browser.storage.local.clear();
      console.log('✅ Test data cleared successfully!');
    } catch (error) {
      console.error('❌ Error clearing test data:', error);
    }
  };

  // Storage stats function
  const getStorageStats = async () => {
    try {
      const data = await browser.storage.local.get();
      const dataString = JSON.stringify(data);
      const stats = {
        totalSize: dataString.length,
        totalSizeMB: (dataString.length / (1024 * 1024)).toFixed(2),
        itemCount: Object.keys(data).length,
        items: Object.keys(data).map(key => ({
          key,
          sizeMB: (JSON.stringify(data[key]).length / (1024 * 1024)).toFixed(2)
        })).sort((a, b) => parseFloat(b.sizeMB) - parseFloat(a.sizeMB))
      };
      console.table(stats.items);
      return stats;
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return null;
    }
  };

  // Make functions available globally
  window.seedTestData = seedTestData;
  window.quickSeed = quickSeed;
  window.clearTestData = clearTestData;
  window.getStorageStats = getStorageStats;

  console.log('✅ Tabox Test Data Seeder loaded successfully!');
  console.log('');
  console.log('📝 Available functions:');
  console.log('   await seedTestData()    - Generate 150+ test collections (full stress test)');
  console.log('   await seedTestData(50)  - Generate specific number of collections');
  console.log('   await quickSeed()       - Generate 25 test collections (quick test)');
  console.log('   await quickSeed(10)     - Generate specific number of collections (quick)');
  console.log('   await clearTestData()   - Clear all test data');
  console.log('   await getStorageStats() - Show storage breakdown');
  console.log('');
  console.log('📌 Tab behavior: Pinned tabs are always first and never in groups');
  console.log('💡 Quick start: await quickSeed()');
  console.log('🚀 Stress test: await seedTestData()');

})();

// Auto-suggest running quick seed
setTimeout(() => {
  console.log('');
  console.log('🌱 Ready to generate test data!');
  console.log('💡 Try: await quickSeed()');
}, 1000); 