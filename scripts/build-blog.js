#!/usr/bin/env node
/**
 * Blog Build Script for MarajTech
 *
 * Reads post files from _posts/ and generates:
 *   - Static HTML pages in blog/  (fully rendered, SEO-ready)
 *   - _posts/posts.json           (post index for the blog listing page)
 *   - sitemap.xml                 (updated with all blog post URLs)
 *
 * Supports two post formats:
 *   - Markdown (.md) with YAML front matter
 *   - JSON (.json) with bodyHtml field
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, '_posts');
const BLOG_DIR = path.join(ROOT, 'blog');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const SITE_URL = 'https://www.marajtech.com';
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Decode HTML entities — handles bodyHtml that arrives pre-escaped */
function unescapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const [year, month, day] = dateStr.split('-').map(Number);
    return `${months[month - 1]} ${day}, ${year}`;
}

function parseFrontMatter(text) {
    const result = {};
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        const quotedMatch = trimmed.match(/^(\w+):\s*"(.*)"\s*$/);
        if (quotedMatch) {
            result[quotedMatch[1]] = quotedMatch[2].replace(/\\"/g, '"');
            continue;
        }
        const unquotedMatch = trimmed.match(/^(\w+):\s*(.+?)\s*$/);
        if (unquotedMatch && unquotedMatch[2] !== '') {
            result[unquotedMatch[1]] = unquotedMatch[2];
        }
    }
    return result;
}

function fetchPexelsImage(keyword) {
    if (!PEXELS_API_KEY || !keyword) return Promise.resolve(null);

    const query = encodeURIComponent(keyword);
    const apiUrl = `https://api.pexels.com/v1/search?query=${query}&per_page=1&orientation=landscape`;

    return new Promise((resolve) => {
        const req = https.request(apiUrl, {
            headers: { 'Authorization': PEXELS_API_KEY }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.photos && json.photos.length > 0) {
                        const photo = json.photos[0];
                        resolve({
                            url: photo.src.large2x || photo.src.large,
                            medium: photo.src.medium,
                            photographer: photo.photographer,
                            photographerUrl: photo.photographer_url,
                            pexelsUrl: photo.url
                        });
                    } else {
                        console.warn(`    No Pexels results for "${keyword}"`);
                        resolve(null);
                    }
                } catch (e) {
                    console.warn(`    Pexels API parse error for "${keyword}":`, e.message);
                    resolve(null);
                }
            });
        });
        req.on('error', (e) => {
            console.warn(`    Pexels API request error for "${keyword}":`, e.message);
            resolve(null);
        });
        req.end();
    });
}

async function enrichPostsWithImages(posts) {
    if (!PEXELS_API_KEY) {
        console.log('  PEXELS_API_KEY not set — skipping image fetch.\n');
        return;
    }

    console.log('  Fetching images from Pexels...');
    for (const post of posts) {
        if (post.imageUrl) {
            console.log(`    + ${post.slug} (already has image)`);
            continue;
        }

        const keyword = post.imageKeyword;
        if (!keyword) {
            console.log(`    - ${post.slug} (no imageKeyword, skipping)`);
            continue;
        }

        const img = await fetchPexelsImage(keyword);
        if (img) {
            post.imageUrl = img.url;
            post.imageMedium = img.medium;
            post.photographer = img.photographer;
            post.photographerUrl = img.photographerUrl;
            post.pexelsUrl = img.pexelsUrl;
            console.log(`    + ${post.slug} -> "${keyword}" (by ${img.photographer})`);
        } else {
            console.log(`    x ${post.slug} -> "${keyword}" (no result)`);
        }

        await new Promise(r => setTimeout(r, 200));
    }
    console.log('');
}

function readPosts() {
    const files = fs.readdirSync(POSTS_DIR);
    const posts = [];

    for (const file of files) {
        if (file === 'posts.json') continue;

        const filePath = path.join(POSTS_DIR, file);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        try {
            if (file.endsWith('.md')) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
                if (!fmMatch) {
                    console.warn(`  Skipping ${file}: no front matter found`);
                    continue;
                }
                const meta = parseFrontMatter(fmMatch[1]);
                const bodyHtml = marked.parse(fmMatch[2]);
                posts.push({
                    title: meta.title || 'Untitled',
                    date: meta.date || null,
                    category: meta.category || 'General',
                    excerpt: meta.excerpt || '',
                    slug: meta.slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, ''),
                    bodyHtml,
                    imageKeyword: meta.imageKeyword || '',
                    imageUrl: meta.featuredImageUrl || '',
                    sourceFile: file
                });

            } else if (file.endsWith('.json')) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(raw);
                const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})[_-]/);
                posts.push({
                    title: data.title || 'Untitled',
                    date: dateMatch ? dateMatch[1] : null,
                    category: data.publishCategory || data.category || 'General',
                    excerpt: data.excerpt || '',
                    slug: data.slug || file.replace(/^\d{4}-\d{2}-\d{2}[_-]/, '').replace(/\.json$/, ''),
                    bodyHtml: unescapeHtml(data.bodyHtml || ''),
                    imageKeyword: data.imageKeyword || '',
                    imageUrl: data.featuredImageUrl || '',
                    sourceFile: file
                });
            }
        } catch (err) {
            console.error(`  Error processing ${file}:`, err.message);
        }
    }

    posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return posts;
}

function generatePostHtml(post) {
    const postUrl = `${SITE_URL}/blog/${post.slug}.html`;
    const postImage = post.imageUrl || `${SITE_URL}/logo-dark.svg`;
    const postExcerpt = post.excerpt || post.title;
    const formattedDate = formatDate(post.date);

    const jsonLd = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post.title,
        "description": postExcerpt,
        "image": postImage,
        "datePublished": post.date,
        "dateModified": post.date,
        "author": { "@type": "Organization", "name": "MarajTech", "url": SITE_URL },
        "publisher": {
            "@type": "Organization",
            "name": "MarajTech",
            "url": SITE_URL,
            "logo": { "@type": "ImageObject", "url": `${SITE_URL}/logo-dark.svg` }
        },
        "mainEntityOfPage": { "@type": "WebPage", "@id": postUrl },
        "url": postUrl,
        "articleSection": post.category || "General",
        "inLanguage": "en-US"
    });

    const imageBlock = post.imageUrl ? `
            <div class="mb-8 rounded-2xl overflow-hidden shadow-md">
                <img src="${escapeAttr(post.imageUrl)}" alt="${escapeAttr(post.title)}" class="w-full h-64 md:h-96 object-cover" loading="eager" />
                ${post.photographer ? `
                <div class="bg-gray-900 bg-opacity-80 px-4 py-2 text-xs text-gray-300">
                    Photo by <a href="${escapeAttr(post.photographerUrl || '#')}" target="_blank" rel="noopener noreferrer" class="text-white hover:underline">${escapeHtml(post.photographer)}</a>
                    on <a href="${escapeAttr(post.pexelsUrl || 'https://www.pexels.com')}" target="_blank" rel="noopener noreferrer" class="text-white hover:underline">Pexels</a>
                </div>` : ''}
            </div>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <link rel="icon" type="image/x-icon" href="/marajtech.ico" />
    <link rel="shortcut icon" type="image/x-icon" href="/marajtech.ico" />
    <link rel="apple-touch-icon" href="/marajtech.ico" />

    <title>${escapeHtml(post.title)} | MarajTech Blog</title>
    <meta name="description" content="${escapeAttr(postExcerpt)}" />
    <meta name="author" content="MarajTech" />
    <meta name="robots" content="index, follow" />

    <meta property="og:type" content="article" />
    <meta property="og:url" content="${postUrl}" />
    <meta property="og:title" content="${escapeAttr(post.title)}" />
    <meta property="og:description" content="${escapeAttr(postExcerpt)}" />
    <meta property="og:image" content="${postImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeAttr(post.title)}" />
    <meta property="og:site_name" content="MarajTech" />
    <meta property="og:locale" content="en_US" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="${postUrl}" />
    <meta name="twitter:title" content="${escapeAttr(post.title)}" />
    <meta name="twitter:description" content="${escapeAttr(postExcerpt)}" />
    <meta name="twitter:image" content="${postImage}" />
    <meta name="twitter:image:alt" content="${escapeAttr(post.title)}" />

    <link rel="canonical" href="${postUrl}" />

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">

    <script src="https://cdn.tailwindcss.com"></script>

    <script type="application/ld+json">${jsonLd}</script>

    <style>
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background-color: #FFFFFF;
            color: #0F172A;
            line-height: 1.6;
        }
        .blog-content { line-height: 1.8; }
        .blog-content h1 { font-size: 2.5rem; font-weight: 700; margin-top: 2rem; margin-bottom: 1rem; color: #0F172A; }
        .blog-content h2 { font-size: 1.875rem; font-weight: 700; margin-top: 2rem; margin-bottom: 1rem; color: #0F172A; }
        .blog-content h3 { font-size: 1.5rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem; color: #0F172A; }
        .blog-content p  { margin-bottom: 1rem; color: #334155; font-size: 1.125rem; }
        .blog-content ul, .blog-content ol { margin-left: 1.5rem; margin-bottom: 1rem; }
        .blog-content li { margin-bottom: 0.5rem; color: #334155; font-size: 1.125rem; }
        .blog-content a  { color: #1E90FF; text-decoration: underline; }
        .blog-content code { background: #F1F5F9; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-family: 'Courier New', monospace; font-size: 0.875rem; }
        .blog-content pre  { background: #F1F5F9; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1rem; }
        .blog-content blockquote { border-left: 4px solid #1E90FF; padding-left: 1rem; margin: 1rem 0; color: #475569; font-style: italic; }
        .logo-container { height: 60px; display: flex; align-items: center; }
        .logo-container img { height: 100%; width: auto; }
    </style>
</head>
<body class="antialiased">

    <header class="bg-white border-b border-gray-200 text-gray-800 p-4 shadow-sm sticky top-0 z-40">
        <div class="container mx-auto flex flex-col sm:flex-row justify-between items-center py-3">
            <a href="/index.html" class="logo-container mb-4 sm:mb-0 rounded-md p-2 hover:bg-gray-50 transition duration-300">
                <img src="/logo-dark.svg" alt="MarajTech Logo" class="h-full w-auto" />
            </a>
            <nav class="flex flex-wrap justify-center gap-x-6 gap-y-2 text-lg font-medium">
                <a href="/index.html#about" class="text-gray-800 hover:text-[#1E90FF] transition duration-300 px-3 py-2 rounded-md hover:bg-gray-50">About</a>
                <a href="/index.html#services" class="text-gray-800 hover:text-[#1E90FF] transition duration-300 px-3 py-2 rounded-md hover:bg-gray-50">Services</a>
                <a href="/blog.html" class="text-[#1E90FF] font-semibold px-3 py-2 rounded-md">Blog</a>
                <a href="/index.html#contact" class="bg-[#1E90FF] hover:bg-[#0066CC] text-white px-6 py-2 rounded-full font-semibold transition duration-300">Contact Us</a>
            </nav>
        </div>
    </header>

    <section class="py-16 px-4 bg-white">
        <div class="container mx-auto max-w-4xl">
            <div class="mb-6">
                <a href="/blog.html" class="text-[#1E90FF] font-semibold hover:underline inline-flex items-center gap-2">
                    &larr; Back to Blog
                </a>
            </div>
            ${imageBlock}
            <div class="bg-white border border-gray-200 p-8 md:p-12 rounded-2xl shadow-sm">
                <article>
                    <div class="flex items-center gap-4 mb-6 text-sm text-gray-500">
                        ${post.date ? `<time datetime="${post.date}">${formattedDate}</time>` : ''}
                        ${post.category ? `<span class="px-3 py-1 bg-blue-50 text-[#1E90FF] rounded-full text-xs font-semibold">${escapeHtml(post.category)}</span>` : ''}
                    </div>
                    <h1 class="text-4xl md:text-5xl font-black mb-8 text-gray-900">${escapeHtml(post.title)}</h1>
                    <div class="blog-content">
                        ${post.bodyHtml}
                    </div>
                </article>
            </div>
        </div>
    </section>

    <footer class="bg-white border-t border-gray-200 text-gray-700 py-12 px-4">
        <div class="container mx-auto max-w-7xl">
            <div class="flex flex-col md:flex-row justify-between items-center mb-8">
                <div class="logo-container mb-6 md:mb-0">
                    <img src="/logo-dark.svg" alt="MarajTech Logo" class="h-12 w-auto" />
                </div>
                <div class="flex flex-wrap justify-center gap-6 mb-6 md:mb-0">
                    <a href="/index.html#services" class="text-gray-700 hover:text-[#1E90FF] transition duration-300">Services</a>
                    <a href="/blog.html" class="text-gray-700 hover:text-[#1E90FF] transition duration-300">Blog</a>
                    <a href="/index.html#contact" class="text-gray-700 hover:text-[#1E90FF] transition duration-300">Contact</a>
                </div>
            </div>
            <div class="flex justify-center items-center gap-6 mb-8">
                <a href="https://www.linkedin.com/company/marajtech" target="_blank" rel="noopener noreferrer" class="text-gray-700 hover:text-[#1E90FF] transform hover:scale-110 transition duration-300">
                    <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" clip-rule="evenodd" /></svg>
                </a>
                <a href="https://twitter.com/marajtech" target="_blank" rel="noopener noreferrer" class="text-gray-700 hover:text-[#1E90FF] transform hover:scale-110 transition duration-300">
                    <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
            </div>
            <p class="text-center text-gray-600 text-sm">&copy; ${new Date().getFullYear()} MarajTech. All rights reserved.</p>
        </div>
    </footer>

</body>
</html>`;
}

function generatePostsJson(posts) {
    const data = {
        posts: posts.map(p => ({
            title: p.title,
            date: p.date,
            category: p.category,
            excerpt: p.excerpt,
            slug: p.slug,
            imageUrl: p.imageMedium || p.imageUrl || '',
            photographer: p.photographer || '',
            photographerUrl: p.photographerUrl || '',
            pexelsUrl: p.pexelsUrl || ''
        }))
    };
    fs.writeFileSync(
        path.join(POSTS_DIR, 'posts.json'),
        JSON.stringify(data, null, 2) + '\n',
        'utf8'
    );
}

function generateSitemap(posts) {
    const today = new Date().toISOString().split('T')[0];

    const staticPages = [
        { loc: '/',              priority: '1.0',  changefreq: 'weekly',  lastmod: today },
        { loc: '/blog.html',     priority: '0.8',  changefreq: 'weekly',  lastmod: today },
    ];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const page of staticPages) {
        xml += `  <url>\n`;
        xml += `    <loc>${SITE_URL}${page.loc}</loc>\n`;
        xml += `    <lastmod>${page.lastmod}</lastmod>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `  </url>\n`;
    }

    xml += `  <!-- Individual Blog Posts -->\n`;
    for (const post of posts) {
        xml += `  <url>\n`;
        xml += `    <loc>${SITE_URL}/blog/${post.slug}.html</loc>\n`;
        xml += `    <lastmod>${post.date || today}</lastmod>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `    <changefreq>monthly</changefreq>\n`;
        xml += `  </url>\n`;
    }

    xml += `</urlset>\n`;
    fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
}

async function main() {
    console.log('Building blog...\n');

    if (!fs.existsSync(BLOG_DIR)) {
        fs.mkdirSync(BLOG_DIR, { recursive: true });
    }

    const posts = readPosts();
    console.log(`Found ${posts.length} post(s):\n`);

    await enrichPostsWithImages(posts);

    for (const post of posts) {
        const html = generatePostHtml(post);
        const outPath = path.join(BLOG_DIR, `${post.slug}.html`);
        fs.writeFileSync(outPath, html, 'utf8');
        console.log(`  + blog/${post.slug}.html`);
    }

    generatePostsJson(posts);
    console.log(`  + _posts/posts.json  (${posts.length} entries)`);

    generateSitemap(posts);
    console.log(`  + sitemap.xml`);

    console.log('\nBuild complete!');
}

main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
