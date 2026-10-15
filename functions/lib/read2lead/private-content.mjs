import { assessBookHealth } from '../../../src/lib/read2lead-book-health.mjs';
import { bandForReadingLoad, readingLoadOf } from '../../api/publish-read2lead-book.js';
import { validatePublisherPackage } from './self-learn/publisher-contract.mjs';

const identity = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const refuse = () => { throw Error('private_content_invalid'); };

/** Server-owned draft bundle, never a publication/teaching approval. Assignment
 * still applies the existing package validator and adult-only draft guard.
 * First listed version per story is assignable; all versions remain addressable.
 */
export function createPrivateContent({pkg, packages = [pkg], legacyBooks = []}) {
  if (!Array.isArray(packages) || !packages.length || packages.length > 4380 ||
      !Array.isArray(legacyBooks) || legacyBooks.length > 2000) refuse();
  const stories = new Map(), indexes = new Map(), selected = new Set(), media = new Map(), books = new Map();
  for (const original of packages) {
    const p = structuredClone(original), l = p?.lesson;
    if (!identity(l?.id) || !identity(l.version) || !/^L[0-5]$/.test(l.level) ||
        !identity(l.source?.source_id) || !Array.isArray(p.assets)) refuse();
    const key = `${l.id}@${l.version}`;
    if (stories.has(key)) refuse();
    stories.set(key, p);
    if (!selected.has(l.id)) {
      selected.add(l.id);
      if (!indexes.has(l.level)) indexes.set(l.level, []);
      indexes.get(l.level).push({id:l.id, version:l.version, source_id:l.source.source_id});
    }
    for (const asset of p.assets) {
      if (typeof asset.object_key !== 'string' || !/^[a-f0-9]{64}\.[a-z0-9]+$/.test(asset.object_key) ||
          !/^[a-f0-9]{64}$/.test(asset.sha256) || !asset.object_key.startsWith(asset.sha256 + '.') ||
          !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || typeof asset.mime !== 'string') refuse();
      const existing = media.get(asset.object_key);
      if (existing && ['sha256','bytes','mime'].some(key => existing[key] !== asset[key])) refuse();
      media.set(asset.object_key, asset);
    }
  }
  const primary = stories.get(`${pkg?.lesson?.id}@${pkg?.lesson?.version}`);
  if (!primary || JSON.stringify(primary) !== JSON.stringify(pkg)) refuse();
  if (selected.size > 1095) refuse();
  if (legacyBooks.length) {
    const shelves = new Map(['L0','L1','L2','L3','L4'].map(level => [level, []]));
    for (const original of legacyBooks) {
      const book = structuredClone(original), slug = book?.book_slug;
      if (!/^book_[0-9]+$/.test(slug) || books.has('book:'+slug) ||
          !assessBookHealth(book,{expectedSlug:slug}).hardOk) refuse();
      const band = bandForReadingLoad(readingLoadOf(book));
      if (!band) refuse();
      shelves.get(band).push(slug);
      books.set('book:'+slug, book);
    }
    books.set('config:book_levels', [...shelves.keys()]);
    for (const [level, slugs] of shelves) books.set('book_index:'+level, slugs);
  }
  return {
    contentSource: legacyBooks.length ? 'combined' : 'one-story-a-day',
    bookValue: key => books.has(key) ? structuredClone(books.get(key)) : undefined,
    storyValue: key => {
      if (key.startsWith('index:')) return structuredClone(indexes.get(key.slice(6)) || []);
      const p = key.startsWith('package:') && stories.get(key.slice(8));
      return p ? {status:'private-draft', package:structuredClone(p)} : null;
    },
    mediaFor: key => structuredClone(media.get(key)),
    fingerprints: async () => Promise.all([...stories].map(async ([key, p]) => {
      const {package_sha256} = await validatePublisherPackage(p);
      return {key,sha256:package_sha256};
    })),
    runtime: {
      catalogue: () => [...stories.values()].map(p => structuredClone(p.lesson)),
      packageFor: lesson => structuredClone(stories.get(`${lesson.id}@${lesson.version}`)),
    },
  };
}
