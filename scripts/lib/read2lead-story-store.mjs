import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, existsSync, chmodSync, lstatSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import {StorySqlStore} from '../../functions/lib/read2lead/story-store.mjs';

/** Filesystem protections are local-only; transaction behavior is shared. */
export class PrivateStoryStore extends StorySqlStore {
  constructor(root, {now=()=>Date.now()}={}) {
    if (!isAbsolute(root) || realpathSync(root) !== root) throw Error('unsafe_story_root');
    const marker = JSON.parse(readFileSync(join(root, 'synthetic-target.json'), 'utf8'));
    if (marker.purpose !== 'read2lead-local-synthetic' || marker.format !== 1) throw Error('synthetic_target_required');
    const filename = join(root, 'read2lead-story-sessions.sqlite');
    if (existsSync(filename)) {
      const info=lstatSync(filename);
      if (realpathSync(filename) !== filename || !info.isFile() || info.nlink !== 1 || info.uid !== process.getuid()) throw Error('unsafe_story_database');
    }
    const db = new DatabaseSync(filename); chmodSync(filename, 0o600);
    db.exec('PRAGMA busy_timeout=5000');
    super(db,{now,uuid:randomUUID,transaction:fn=>{
      db.exec('BEGIN IMMEDIATE');
      try {const value=fn();db.exec('COMMIT');return value;}
      catch(error){db.exec('ROLLBACK');throw error;}
    }});
  }
}
