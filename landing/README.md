# folkbranch.com

The public site: an English page, a Russian page under `/ru/`, a 404 page, `sitemap.xml`, `robots.txt` and `llms.txt`. It is plain HTML behind nginx, with no build step.

- Edit the files in `site/`. Keep each page's `<title>`, description, canonical, `hreflang`, Open Graph and JSON-LD in step with its text, and update `softwareVersion`, `dateModified`, the visible "updated" date in the footer, `sitemap.xml` lastmod and `llms.txt` with every release.
- `nginx.conf` holds the host redirect (`www` to the bare domain), the cache headers and the 404 page.
- Check locally: `docker build -t folkbranch-landing landing && docker run --rm -p 8081:8080 folkbranch-landing`.
- Deploy (public): `railway up --project 5153e471-ba06-4523-a79f-005db5ba52a4 --environment production --service landing --ci` from this folder, then compare the live HTML with `site/`.
- The pictures in `site/assets/` for the home page (`step-*`, `hero-*`) come from `node scripts/readme-shots.mjs --landing landing/site/assets` after `pnpm build`, on the invented demo family; convert the PNGs to webp (and shave the dialog edges) before committing.
