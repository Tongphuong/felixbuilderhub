import { stringToBytes } from './utils.js';
/**
 * Formats a string value for JSON output, escaping special characters.
 * Yields the formatted string in chunks for memory efficiency.
 *
 * @param str - The string to format
 * @param chunkSize - Maximum size of each yielded chunk (default: 1024)
 * @yields Formatted string chunks with proper JSON escaping
 */
function* formatString(str, chunkSize = 1024) {
    // Read2Lead patch: native escaping preserves well-formed JSON semantics,
    // including lone surrogates. Chunk boundaries are handled by the caller.
    const formatted = JSON.stringify(str);
    for (let i = 0; i < formatted.length; i += chunkSize) {
        yield formatted.slice(i, i + chunkSize);
    }
}
/**
 * Determines if a value should be ignored during stringification.
 * Functions and undefined values are not valid in JSON.
 *
 * @param value - The value to check
 * @returns True if the value should be ignored
 */
function shouldIgnore(value) {
    return typeof value === 'function' || value === undefined;
}
/**
 * Type guard to check if an object has a custom toJSON method.
 *
 * @param value - The object to check
 * @returns True if the object has a toJSON method
 */
function hasCustomToJsonFunction(value) {
    return 'toJSON' in value && typeof value.toJSON === 'function';
}
/**
 * Type guard to check if an object has a custom toString method.
 * Excludes default Object and Array toString methods.
 *
 * @param value - The object to check
 * @returns True if the object has a custom toString method
 */
function hasCustomToStringFunction(value) {
    return ('toString' in value &&
        typeof value.toString === 'function' &&
        value.toString !== Object.prototype.toString &&
        value.toString !== Array.prototype.toString);
}
/**
 * Yields comment string(s) for a given path from the comments map.
 */
function* emitComments(path, options, indentStr) {
    if (!options?.comments || !options.comments[path])
        return;
    const entries = options.comments[path];
    const list = Array.isArray(entries) ? entries : [entries];
    for (const entry of list) {
        const text = typeof entry === 'string' ? entry : entry.text;
        const style = typeof entry === 'string' ? 'line' : (entry.style ?? 'line');
        if (style === 'line') {
            yield `${indentStr}// ${text}\n`;
        }
        else {
            yield `${indentStr}/* ${text} */\n`;
        }
    }
}
/**
 * Internal recursive function that stringifies a value with depth tracking.
 * Handles all JSON types including primitives, arrays, and objects.
 *
 * @param value - The value to stringify
 * @param replacer - Optional replacer function for value transformation
 * @param indent - Number of spaces for indentation (0 for compact)
 * @param currentDepth - Current nesting depth for indentation
 * @param start - Indicates if this is the start of the stringification
 * @param options - Stringification options
 * @param currentPath - Current dot-notation path for comment matching
 * @yields String chunks representing the JSON output
 */
function* jsonStreamStringifyWithDepth(value, replacer, indent = 0, currentDepth = 0, start = true, options, currentPath = '') {
    if (replacer) {
        value = replacer('', value);
    }
    if (value && typeof value === 'object') {
        if (hasCustomToJsonFunction(value)) {
            value = value.toJSON();
        }
        else if (hasCustomToStringFunction(value)) {
            value = value.toString();
        }
    }
    // If this is the first call and indenting, add initial indentation
    if (start && indent > 0 && currentDepth > 0) {
        yield ' '.repeat(indent * currentDepth);
    }
    if (value === null) {
        yield 'null';
    }
    else if (typeof value === 'boolean') {
        yield value ? 'true' : 'false';
    }
    else if (typeof value === 'number') {
        yield Number.isFinite(value) ? value.toString() : 'null';
    }
    else if (typeof value === 'string') {
        yield* formatString(value, options?.stringChunkSize);
    }
    else if (Array.isArray(value)) {
        const len = value.length;
        const valueIndent = indent * (currentDepth + 1);
        const valueIndentStr = indent > 0 ? ' '.repeat(valueIndent) : '';
        const isJsonc = options?.jsonc === true;
        yield '[';
        for (let i = 0; i < len; i++) {
            const next = value[i];
            const isLast = i === len - 1;
            if (i > 0) {
                yield ',';
            }
            if (indent > 0) {
                yield '\n';
                const itemPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
                yield* emitComments(itemPath, options, valueIndentStr);
                yield valueIndentStr;
            }
            if (shouldIgnore(next)) {
                yield 'null';
                if (isLast && isJsonc)
                    yield ',';
                continue;
            }
            const itemPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
            yield* jsonStreamStringifyWithDepth(next, replacer, indent > 0 ? indent : 0, currentDepth + 1, false, options, itemPath);
            if (isLast && isJsonc)
                yield ',';
        }
        if (indent > 0 && len > 0) {
            yield '\n' + ' '.repeat(indent * currentDepth);
        }
        yield ']';
    }
    else if (typeof value === 'object') {
        const keys = Object.keys(value);
        const len = keys.length;
        const valueIndent = indent * (currentDepth + 1);
        const valueIndentStr = indent > 0 ? ' '.repeat(valueIndent) : '';
        const isJsonc = options?.jsonc === true;
        let count = 0;
        // Count non-ignored keys for trailing comma logic
        const validKeys = keys.filter((k) => !shouldIgnore(value[k]));
        const totalValid = validKeys.length;
        yield '{';
        for (let i = 0; i < len; i++) {
            const key = keys[i];
            const next = value[key];
            if (shouldIgnore(next)) {
                continue;
            }
            if (count > 0) {
                yield ',';
            }
            const memberPath = currentPath ? `${currentPath}.${key}` : key;
            if (indent > 0) {
                yield '\n';
                yield* emitComments(memberPath, options, valueIndentStr);
                yield valueIndentStr;
            }
            yield* formatString(key, options?.stringChunkSize);
            yield `:${indent > 0 ? ' ' : ''}`;
            yield* jsonStreamStringifyWithDepth(next, replacer, indent > 0 ? indent : 0, currentDepth + 1, false, options, memberPath);
            count++;
            if (count === totalValid && isJsonc)
                yield ',';
        }
        if (indent > 0 && len > 0) {
            yield '\n' + ' '.repeat(indent * currentDepth);
        }
        yield '}';
    }
}
/**
 * Converts a JavaScript value to JSON format, yielding string chunks.
 * Provides memory-efficient streaming stringification for large objects.
 *
 * @param value - The value to stringify
 * @param replacer - Optional replacer function or array for filtering/transforming values
 * @param indent - Number of spaces for indentation (0 for compact output)
 * @param options - Additional stringification options
 * @returns Generator yielding JSON string chunks
 *
 * @example
 * ```typescript
 * const data = { name: "John", age: 30 };
 * for (const chunk of jsonStreamStringify(data)) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export function jsonStreamStringify(value, replacer, indent = 0, options) {
    return jsonStreamStringifyWithDepth(value, replacer, indent, 0, true, options);
}
/**
 * Converts a JavaScript value to JSON format, yielding Uint8Array byte chunks.
 * Provides memory-efficient streaming stringification with binary output.
 *
 * @param value - The value to stringify
 * @param replacer - Optional replacer function or array for filtering/transforming values
 * @param indent - Number of spaces for indentation (0 for compact output)
 * @param options - Additional stringification options
 * @returns Generator yielding JSON as Uint8Array chunks
 *
 * @example
 * ```typescript
 * const data = { name: "John", age: 30 };
 * for (const chunk of jsonStreamStringifyBytes(data)) {
 *   await stream.write(chunk);
 * }
 * ```
 */
export function* jsonStreamStringifyBytes(value, replacer, indent = 0, options) {
    const stringGenerator = jsonStreamStringify(value, replacer, indent, options);
    for (const chunk of stringGenerator) {
        yield stringToBytes(chunk);
    }
}
export async function* jsonStreamStringifyAsync(value, replacer, indent = 0, options) {
    yield '[';
    if (indent > 0)
        yield '\n';
    let isFirst = true;
    for await (const item of value) {
        const stringGenerator = jsonStreamStringifyWithDepth(item, replacer, indent, 1, true, options);
        if (!isFirst) {
            yield ',';
            if (indent > 0)
                yield '\n';
        }
        else {
            isFirst = false;
        }
        for (const chunk of stringGenerator) {
            yield chunk;
        }
    }
    if (indent > 0)
        yield '\n';
    yield ']';
}
export async function* jsonStreamStringifyBytesAsync(value, replacer, indent = 0, options) {
    for await (const chunk of jsonStreamStringifyAsync(value, replacer, indent, options)) {
        yield stringToBytes(chunk);
    }
}
