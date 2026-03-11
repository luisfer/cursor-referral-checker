![Cursor Ambassador Referral Checker banner](public/readme-banner-2.png)

# Cursor Ambassador Referral Checker

Batch-check Cursor referral codes to find which are still available. Feed it a list of referral URLs and get back a clean list of unused codes -- from the command line or piped from a file.

## Prerequisites

- [Node.js](https://nodejs.org/) **v18 or higher**

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/luisfer/cursor-referral-checker.git
cd cursor-referral-checker
npm install

# 2. Download the Chromium browser (first time only)
npx playwright install chromium

# 3. Add your referral URLs (one per line)
cp urls.example.txt urls.txt
# Edit urls.txt with your own referral URLs

# 4. Run
npm run check:file
```

Available codes are saved to `dist.txt`.

## Usage

### From a file (recommended)

Create a `urls.txt` with one referral URL per line (see `urls.example.txt` for the format):

```
https://cursor.com/referral?code=XXXXX
https://cursor.com/referral?code=YYYYY
https://cursor.com/referral?code=ZZZZZ
```

Then run:

```bash
npm run check:file
```

### Direct arguments

```bash
npm run check -- https://cursor.com/referral?code=XXXXX https://cursor.com/referral?code=YYYYY
```

### Piped input

```bash
cat urls.txt | node check-referral-codes.mjs
```

## Project Structure

- `check-referral-codes.mjs`: main CLI script. Launches headless Chromium, visits each URL, and detects used vs available codes.
- `urls.example.txt`: example input file template.

## How It Works

1. Launches a headless Chromium browser via Playwright.
2. Visits each referral URL and waits for the page to render.
3. Checks the page content for the "already been used" message.
4. Prints real-time results with status icons (`✓` available, `✗` used, `?` error).
5. Writes all available URLs to `dist.txt`.

## Input File Format

One URL per line. Lines starting with `#` are treated as comments. The parser also handles CSV files -- it extracts the first `http` URL from each line.

**Plain text** (`.txt`):

```
https://cursor.com/referral?code=XXXXX
https://cursor.com/referral?code=YYYYY
```

**CSV with extra columns** -- also works:

```csv
Code,URL
ABC123,https://cursor.com/referral?code=ABC123
GHI789,https://cursor.com/referral?code=GHI789
```

**Mixed / messy files** -- the parser extracts what it can:

```
Header row with no URL
ABC123DEF456,https://cursor.com/referral?code=ABC123DEF456
some random text
https://cursor.com/referral?code=YYYYY
```

Result: 2 URLs extracted, other lines ignored.

## Output

Console output (real-time):

```
[1/100] ✗ https://cursor.com/referral?code=XXXXX → used
[2/100] ✓ https://cursor.com/referral?code=YYYYY → available
[3/100] ? https://cursor.com/referral?code=ZZZZZ → error (timeout)

--- Summary ---
Used: 85 | Available: 15 | Errors: 0

Available URLs written to dist.txt
```

File output (`dist.txt`): one available URL per line.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| Navigation timeout | 15 s | Max wait for page load per URL |
| Render delay | 1.2 s | Extra wait for React/Next.js hydration |
| Output file | `dist.txt` | Where available URLs are saved |
| Concurrency | 3 | Number of URLs checked in parallel |

## Tech Stack

- **Node.js** (>=18) with ES Modules
- **Playwright** for headless browser automation

## Credits

Designed and implemented by [Luis Fernando Romero Calero](https://lfrc.me) and [Cursor](https://cursor.com).

Part of the [Cursor Ambassador](https://cursor.com/ambassador) open-source toolkit.

See also:
- [cursor-ambassador-evergreen](https://github.com/luisfer/cursor-ambassador-evergreen) -- reusable community website template.
- [cursor-ambassador-qr-printer](https://github.com/luisfer/cursor-ambassador-qr-printer) -- printable QR code cards for events.

## License

MIT
