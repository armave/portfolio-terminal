'use strict';

const path = require('path');
const win32 = process.platform === 'win32';
const {
  REGEX_BACKSLASH,
  REGEX_SPECIAL_CHARS,
  REGEX_SPECIAL_CHARS_GLOBAL
} = require('./constants');

exports.isObject = val => val !== null && typeof val === 'object' && !Array.isArray(val);
exports.hasRegexChars = str => REGEX_SPECIAL_CHARS.test(str);
exports.isRegexChar = str => str.length === 1 && exports.hasRegexChars(str);
exports.escapeRegex = str => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, '\\$1');
exports.toPosixSlashes = str => str.replace(REGEX_BACKSLASH, '/');

function isLineTerminator(char) {
  return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
}

/**
 * Remove escape backslashes without rescanning the remainder of the pattern
 * for each unmatched opening bracket. The previous lazy regular expression
 * had quadratic behavior on repeated '[' input.
 */
exports.removeBackslashes = str => {
  const length = str.length;
  const nextValidClose = new Int32Array(length + 1);
  const nextLineTerminator = new Int32Array(length + 1);
  let nextClose = -1;
  let nextLine = -1;

  for (let index = length - 1; index >= 0; index--) {
    if (str[index] === ']' && index > 0 && str[index - 1] !== '\\') {
      nextClose = index;
    }
    if (isLineTerminator(str[index])) {
      nextLine = index;
    }
    nextValidClose[index] = nextClose;
    nextLineTerminator[index] = nextLine;
  }

  const output = [];
  let index = 0;
  let segmentStart = 0;

  while (index < length) {
    if (str[index] === '[' && index + 2 < length) {
      const close = nextValidClose[index + 2];
      const line = nextLineTerminator[index + 1];
      // The regex's dot cannot cross a line terminator. It may consume the
      // line terminator as its final [^\\] character only if ']' follows it.
      if (close >= index + 2 && (line === -1 || line >= close - 1)) {
        output.push(str.slice(segmentStart, index), str.slice(index, close + 1));
        index = close + 1;
        segmentStart = index;
        continue;
      }
    }

    if (str[index] === '\\' && index + 1 < length && !isLineTerminator(str[index + 1])) {
      output.push(str.slice(segmentStart, index));
      index++;
      segmentStart = index;
      continue;
    }

    index++;
  }

  output.push(str.slice(segmentStart));
  return output.join('');
};

exports.supportsLookbehinds = () => {
  const segs = process.version.slice(1).split('.').map(Number);
  if (segs.length === 3 && segs[0] >= 9 || (segs[0] === 8 && segs[1] >= 10)) {
    return true;
  }
  return false;
};

exports.isWindows = options => {
  if (options && typeof options.windows === 'boolean') {
    return options.windows;
  }
  return win32 === true || path.sep === '\\';
};

exports.escapeLast = (input, char, lastIdx) => {
  const idx = input.lastIndexOf(char, lastIdx);
  if (idx === -1) return input;
  if (input[idx - 1] === '\\') return exports.escapeLast(input, char, idx - 1);
  return `${input.slice(0, idx)}\\${input.slice(idx)}`;
};

exports.removePrefix = (input, state = {}) => {
  let output = input;
  if (output.startsWith('./')) {
    output = output.slice(2);
    state.prefix = './';
  }
  return output;
};

exports.wrapOutput = (input, state = {}, options = {}) => {
  const prepend = options.contains ? '' : '^';
  const append = options.contains ? '' : '$';

  let output = `${prepend}(?:${input})${append}`;
  if (state.negated === true) {
    output = `(?:^(?!${output}).*$)`;
  }
  return output;
};
