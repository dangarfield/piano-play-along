import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import sharp from 'sharp';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

puppeteer.use(StealthPlugin());

interface Args {
  url?: string;
  name?: string;
  set?: string;
}

const argv = yargs(hideBin(process.argv))
  .option('u', {
    alias: 'url',
    type: 'string',
    description: 'URL to download from',
  })
  .option('n', {
    alias: 'name',
    type: 'string',
    description: 'Name for the download',
  })
  .option('s', {
    alias: 'set',
    type: 'string',
    description: 'URL of a set to download all scores from',
  })
  .check((argv) => {
    if (!argv.url && !argv.set) {
      throw new Error('Either -u/--url or -s/--set must be provided');
    }
    if (argv.url && !argv.name) {
      throw new Error('-n/--name is required when using -u/--url');
    }
    return true;
  })
  .parseSync() as Args;

const DL_DIR = path.join('muse', 'dl');
const INPUT_DIR = path.join('muse', 'input');
const OUTPUT_DIR = path.join('muse', 'output');
const RES_DIR = path.join('muse', 'res');
const MXL_DIR = path.join('muse', 'mxl');
const SETS_DIR = path.join('muse', 'sets');

// ============================================================================
// STEP 1: Download score images from MuseScore
// ============================================================================
async function step1_downloadScores() {
  // Ensure output directory exists and clear old files
  if (fs.existsSync(DL_DIR)) {
    fs.rmSync(DL_DIR, { recursive: true });
  }
  fs.mkdirSync(DL_DIR, { recursive: true });

  console.log(`Starting download from: ${argv.url}`);
  console.log(`Output name: ${argv.name}`);

  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });
  const page = await browser.newPage();

  let pendingRequests = 0;
  const savedFiles = new Set<string>();

  // Intercept and save score images
  await page.setRequestInterception(true);
  
  page.on('request', async (request) => {
    const url = request.url();
    const urlObj = new URL(url);
    const filename = path.basename(urlObj.pathname);

    // Match score_0.svg, score_1.png, score_2.png, etc. (but not score_0.png)
    const match = filename.match(/^score_(\d+)\.(svg|png)$/);
    
    if (match) {
      const index = parseInt(match[1]);
      const ext = match[2];

      // Skip score_0.png
      if (index === 0 && ext === 'png') {
        request.continue();
        return;
      }

      pendingRequests++;
      console.log(`Intercepting: ${filename}`);

      try {
        await request.continue();
      } catch (error) {
        console.error(`Error continuing request ${filename}:`, error);
      }
    } else {
      request.continue();
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    const urlObj = new URL(url);
    const filename = path.basename(urlObj.pathname);

    const match = filename.match(/^score_(\d+)\.(svg|png)$/);
    
    if (match) {
      const index = parseInt(match[1]);
      const ext = match[2];

      if (index === 0 && ext === 'png') {
        return;
      }

      try {
        const buffer = await response.buffer();
        const outputPath = path.join(DL_DIR, `${argv.name}_${index}.${ext}`);
        fs.writeFileSync(outputPath, buffer);
        savedFiles.add(outputPath);
        console.log(`Saved: ${outputPath}`);
      } catch (error) {
        console.error(`Error saving ${filename}:`, error);
      } finally {
        pendingRequests--;
      }
    }
  });

  // Navigate to the URL
  await page.goto(argv.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Handle cookie dialog if present
  try {
    await page.waitForSelector('#accept-btn', { timeout: 5000 });
    await page.click('#accept-btn');
    console.log('Accepted cookies');
  } catch {
    // No cookie dialog or already dismissed
  }

  // Wait a bit for page to settle
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Scroll to bottom
  console.log('Scrolling to bottom...');
  await autoScroll(page);
  
  // Extra wait after scrolling
  console.log('Waiting for lazy-loaded images...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Wait for all pending requests to complete
  console.log('Waiting for all downloads to complete...');
  while (pendingRequests > 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\nDownload complete! Saved ${savedFiles.size} files to ${DL_DIR}`);
  
  await browser.close();
}

async function autoScroll(page: Page) {
  const scrolled = await page.evaluate(async () => {
    const scroller = document.getElementById('jmuse-scroller-component');
    if (!scroller) {
      console.error('Scroller element not found');
      return false;
    }
    
    console.log('Starting scroll, scrollHeight:', scroller.scrollHeight);
    
    await new Promise<void>((resolve) => {
      let scrollAttempts = 0;
      const maxAttempts = 100;
      const distance = 200;
      
      const timer = setInterval(() => {
        const beforeScroll = scroller.scrollTop;
        scroller.scrollTop += distance;
        const afterScroll = scroller.scrollTop;
        
        console.log(`Scroll attempt ${scrollAttempts}: ${beforeScroll} -> ${afterScroll}`);
        
        scrollAttempts++;
        
        // Stop if we can't scroll anymore or hit max attempts
        if (beforeScroll === afterScroll || scrollAttempts >= maxAttempts) {
          clearInterval(timer);
          console.log('Scroll complete');
          resolve();
        }
      }, 200);
    });
    
    return true;
  });
  
  if (!scrolled) {
    console.error('Failed to scroll');
  }
}

// ============================================================================
// STEP 2: Convert SVG images to PNG at high resolution (300 DPI)
// ============================================================================
async function step2_convertSvgToPng() {
  // Ensure input directory exists and clear old files
  if (fs.existsSync(INPUT_DIR)) {
    fs.rmSync(INPUT_DIR, { recursive: true });
  }
  fs.mkdirSync(INPUT_DIR, { recursive: true });

  console.log('Converting SVG files to PNG at 300 DPI...');

  const files = fs.readdirSync(DL_DIR);
  const svgFiles = files.filter(f => f.endsWith('.svg'));

  for (const file of svgFiles) {
    const inputPath = path.join(DL_DIR, file);
    const outputPath = path.join(INPUT_DIR, file.replace('.svg', '.png'));

    try {
      const metadata = await sharp(inputPath).metadata();
      const scale = 3; // 3x scale for OCR
      const newWidth = Math.round((metadata.width || 1000) * scale);

      await sharp(inputPath, { density: 300 })
        .resize(newWidth)
        .png()
        .toFile(outputPath);

      console.log(`Converted: ${file} -> ${path.basename(outputPath)} (width: ${newWidth}px)`);
    } catch (error) {
      console.error(`Error converting ${file}:`, error);
    }
  }

  console.log(`\nConversion complete! Saved ${svgFiles.length} PNG files to ${INPUT_DIR}`);
}

// ============================================================================
// STEP 4: Manual concatenation required
// ============================================================================
async function step4_copyForManualMerge() {
  // Clear and prepare mxl directory
  if (fs.existsSync(MXL_DIR)) {
    fs.rmSync(MXL_DIR, { recursive: true });
  }
  fs.mkdirSync(MXL_DIR, { recursive: true });

  console.log('Copying .mxl files from res to mxl folder for manual merging...');

  // Copy all .mxl files from RES_DIR to MXL_DIR
  const files = fs.readdirSync(RES_DIR).filter(f => f.endsWith('.mxl'));
  
  for (const file of files) {
    const sourcePath = path.join(RES_DIR, file);
    const destPath = path.join(MXL_DIR, file);
    fs.copyFileSync(sourcePath, destPath);
    console.log(`Copied: ${file}`);
  }

  console.log(`\n${files.length} files copied to ${MXL_DIR}`);
  console.log('Use external tool (e.g., Python merger GUI) to concatenate these files.');
}


// ============================================================================
// SET MODE: Download all scores from a set
// ============================================================================
async function downloadSet() {
  if (!argv.set) return;

  fs.mkdirSync(SETS_DIR, { recursive: true });

  console.log(`Opening set: ${argv.set}`);

  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: { width: 1920, height: 1080 }
  });
  const page = await browser.newPage();

  // Set download path
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: path.resolve(SETS_DIR)
  });

  await page.goto(argv.set, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Handle cookie dialog
  try {
    await page.waitForSelector('#accept-btn', { timeout: 5000 });
    await page.click('#accept-btn');
    console.log('Accepted cookies');
  } catch {
    // No cookie dialog
  }

  await new Promise(resolve => setTimeout(resolve, 3000));

  // Get all score links
  const scoreLinks = await page.$$eval('article a', (links) => 
    links
      .map(a => a.href)
      .filter(href => href.includes('/scores/'))
  );

  console.log(`Found ${scoreLinks.length} scores in set`);

  for (let i = 0; i < scoreLinks.length; i++) {
    const scoreUrl = scoreLinks[i];
    console.log(`\n[${i + 1} of ${scoreLinks.length}] Processing: ${scoreUrl}`);

    try {
      await page.goto(scoreUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Click download button
      const downloadBtn = await page.$('button[name="download"]');
      if (!downloadBtn) {
        console.log('  ✗ Download button not found');
        continue;
      }

      await downloadBtn.click();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Wait for dialog
      const dialog = await page.waitForSelector('article[role="dialog"]', { timeout: 5000 });
      if (!dialog) {
        console.log('  ✗ Download dialog not found');
        continue;
      }

      // Get all buttons in dialog and click the 3rd one
      const buttons = await dialog.$$('div[role="button"]');
      if (buttons.length < 3) {
        console.log(`  ✗ Expected 3+ buttons, found ${buttons.length}`);
        continue;
      }

      await buttons[2].click();
      console.log('  ✓ Clicked download option');
      
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.log(`  ✗ Error: ${error}`);
    }
  }

  console.log(`\nSet download complete! Files saved to ${SETS_DIR}`);
  await browser.close();
}

async function main() {
  if (argv.set) {
    await downloadSet();
    return;
  }

  // await step1_downloadScores();
  // await step2_convertSvgToPng();
  // await step3_runAudiveris();
  await step4_copyForManualMerge();
}

main().catch(console.error);
