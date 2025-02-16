import { defineBackground } from 'wxt/sandbox';

// Keep these at top level
let screenshots: string[] = [];
const captureOptions = { format: "png" };
let lastScreenshotData: string | null = null;
let firstImageDimensions: { width: number; height: number } = { width: 0, height: 0 };

async function detectOverlap(lastImageUrl: string, currentImageUrl: string): Promise<number> {
  // Convert data URLs to ImageData
  const getImageData = async (dataUrl: string): Promise<ImageData> => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    
    ctx.drawImage(bitmap, 0, 0);
    // Get a larger portion to ensure we catch the navbar and overlap
    const portion = Math.floor(bitmap.height * 0.3);
    return ctx.getImageData(0, bitmap.height - portion, bitmap.width, portion);
  };

  const lastImageBottom = await getImageData(lastImageUrl);
  const currentImageTop = await getImageData(currentImageUrl);

  const threshold = 20; // Pixel intensity difference threshold
  const minNavbarCheck = 70; // Always check at least this many rows
  let overlapPixels = 0;

  // Check each row of pixels
  for (let y = 0; y < lastImageBottom.height; y++) {
    let matchingPixels = 0;
    
    // Compare each pixel in the row
    for (let x = 0; x < lastImageBottom.width; x++) {
      const lastIndex = (y * lastImageBottom.width + x) * 4;
      const currentIndex = (y * currentImageTop.width + x) * 4;

      // Compare RGB values
      const rDiff = Math.abs(lastImageBottom.data[lastIndex] - currentImageTop.data[currentIndex]);
      const gDiff = Math.abs(lastImageBottom.data[lastIndex + 1] - currentImageTop.data[currentIndex + 1]);
      const bDiff = Math.abs(lastImageBottom.data[lastIndex + 2] - currentImageTop.data[currentIndex + 2]);

      if (rDiff < threshold && gDiff < threshold && bDiff < threshold) {
        matchingPixels++;
      }
    }

    // If 90% of pixels in this row match
    if (matchingPixels / lastImageBottom.width > 0.9) {
      overlapPixels++;
    } else if (y >= minNavbarCheck && overlapPixels > 0) {
      // If we've checked past the navbar height and found some overlap,
      // a non-matching row means we've found the end of the overlap
      break;
    }
    // If we haven't found any overlap yet, keep checking (could be navbar)
  }

  console.log(`Detected ${overlapPixels} pixels of overlap (checked at least ${minNavbarCheck}px)`);
  return overlapPixels;
}

async function executeScroll(tabId: number, scrollDistance: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (distance) => {
      window.scrollBy({ top: distance, behavior: "smooth" });
    },
    args: [scrollDistance],
  });
}

async function calculateTotalPages(tabId: number): Promise<number> {
  // Send progress update to app.tsx
  chrome.runtime.sendMessage({
    action: "calculating",
  });
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const documentHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.offsetHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight
      );
      const viewportHeight = window.innerHeight;
      const overlap = viewportHeight * 0.1; // 10% overlap
      const effectiveScrollDistance = viewportHeight - overlap;
      
      return Math.ceil(documentHeight / effectiveScrollDistance);
    }
  });

  if (!result || !result[0] || typeof result[0].result !== 'number') {
    return 1; // Default to 1 page if calculation fails
  }

  return result[0].result;
}

async function captureScreenshot(): Promise<string> {
  const captureOptions = { format: "png" };
  return new Promise<string>((resolve, reject) => {
    chrome.windows.getCurrent((window) => {
      if (!window.id) {
        console.log("No window id found");
        reject(new Error("No window id found"));
        return;
      }
      chrome.tabs.captureVisibleTab(window.id, captureOptions, async (dataUrl) => {
        if (!dataUrl) {
          console.log("No screenshot data captured");
          reject(new Error("No screenshot data captured"));
          return;
        }
        resolve(dataUrl);
      });
    });
  });
}
const savePDF = async (fileName: string) => {
  const { jsPDF } = await import('jspdf');
  
  // Get dimensions from first screenshot
  const img = await createImageBitmap(await (await fetch(screenshots[0])).blob());
  const width = img.width;
  const height = img.height;
  
  // Create PDF
  const pdf = new jsPDF({
    orientation: width > height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [width, height]
  });

  // Get active tab for OCR
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id) return;

  // Process each screenshot
  for (let i = 0; i < screenshots.length; i++) {
    if (i > 0) {
      pdf.addPage([width, height]);
    }
    
    // Add screenshot
    pdf.addImage(screenshots[i], 'PNG', 0, 0, width, height);

  

    
  }

  // Save PDF
  const pdfOutput = pdf.output('datauristring');
  await chrome.downloads.download({
    url: pdfOutput,
    filename: fileName,
    saveAs: true
  });

  console.log('PDF file created successfully!');
};
const captureFull = async (tabId: number, currentPage: number, totalPages: number, fileName: string) => {
  console.log(`Capturing page ${currentPage} of ${totalPages}`);
  
  // Send progress update to app.tsx
  chrome.runtime.sendMessage({
    action: "captureProgress",
    progress: {
      current: currentPage,
      total: totalPages
    }
  });
  
  // Wait for scroll to complete
  await new Promise(resolve => setTimeout(resolve, 500));
  // Get the screenshot
  const currentScreenshot = await captureScreenshot();
  if (!currentScreenshot) {
    console.log("No screenshot captured");
    return;
  }

  // Add screenshot to array
  screenshots.push(currentScreenshot);
  console.log(`Added screenshot ${screenshots.length}`);

  if (currentPage >= totalPages) {
    console.log("Reached total pages, creating PDF...");
    await savePDF(fileName);
    // Reset screenshots array for next capture
    screenshots = [];
    return;
  }

  // Get viewport height
  const viewportHeight = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.innerHeight
  }).then(result => result[0].result);
  if (!viewportHeight) {console.log("No viewport height found"); return;}
  // Calculate scroll distance
  let scrollDistance = viewportHeight * 0.9;
  if (lastScreenshotData) {
    const overlap = await detectOverlap(lastScreenshotData, currentScreenshot);
    console.log(`Overlap detected: ${overlap}px`);
    scrollDistance = (viewportHeight * 0.9) - overlap;
    console.log(`Adjusted scroll distance: ${scrollDistance}px`);
  }

  // Store current screenshot for next overlap comparison
  lastScreenshotData = currentScreenshot;

  // Scroll
  await executeScroll(tabId, scrollDistance);
  
  // Wait for scroll to complete
  await new Promise(resolve => setTimeout(resolve, 1500));

  // Capture next page
  await captureFull(tabId, currentPage + 1, totalPages, fileName);
};


export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === "captureTab") {
      // Send initial loading state
      chrome.runtime.sendMessage({
        action: "captureProgress",
        progress: {
          current: 0,
          total: 0
        }
      });

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const fileName = !tab.url ? '-pdf-r.pdf' : 
        `${new URL(tab.url).hostname.replace('www.', '').split('.')[0]}-pdf-r.pdf`;

      if (!tab.id) {
        console.log("No tab id found"); 
        return;
      }
      // Reset scroll position to top of page
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.scrollTo(0, 0)
      });

      captureFull(tab.id, 1, await calculateTotalPages(tab.id), fileName);
      console.log("Full page captured");
    }
  });
});
