declare function picomatch(
  glob: string | string[],
  options?: Record<string, unknown>,
  returnState?: boolean
): (input: string) => boolean;

declare namespace picomatch {
  function isMatch(
    input: string,
    glob: string | string[],
    options?: Record<string, unknown>
  ): boolean;
  function makeRe(
    glob: string,
    options?: Record<string, unknown>
  ): RegExp;
}

export = picomatch;
