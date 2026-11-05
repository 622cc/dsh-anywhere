/** Chinese and Japanese set a name beside their own words without a space, and a Latin name with one. */
export const spaceAfter = (name: string) => (/[\x21-\x7e]$/.test(name) ? ' ' : '')
