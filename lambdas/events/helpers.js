// BUG: Trailing newlines break this entirely
export function wrap(text, firstIndent = 0, secondIndent = 0, width = 32) {
  const lines = text.split('\n')
  // use the first lines' indent as a baseline
  // const indent = lines[0].match(/^\s{0,2}/)[0].length
  // have we linewrapped yet?
  let res = ''

  lines.forEach((line) => {
    const words = line.split(' ')
    let wrapped = false
    let wordsIndex = 0
    let lineLength = 0

    while (wordsIndex < words.length) {
      // while we have space for the current line, a space, and the next word...
      while (words[wordsIndex] && width - lineLength - words[wordsIndex].length > 1) {
        if (lineLength === 0 && wrapped === false) {
          res += ' '.repeat(firstIndent)
          lineLength += firstIndent
        } else {
          res += ' '
          lineLength += 1
        }
        res += words[wordsIndex]
        lineLength += words[wordsIndex].length
        wordsIndex++
      }

      // if the word is too big to fit on even a blank line,
      if (words[wordsIndex] && words[wordsIndex].length > width - firstIndent) {
        res += ' ' + words[wordsIndex].slice(0, width - lineLength - 1)
        // bug: words twice (or more) the width won't wrap correctly
        res += '\n' + ' '.repeat(firstIndent) + words[wordsIndex].slice(width - lineLength - 1)
        lineLength = firstIndent
        wordsIndex++
      } else if (words[wordsIndex + 1] && words[wordsIndex + 1].length > width - firstIndent) {
        res += '\n' + ' '.repeat(firstIndent) + words[wordsIndex + 2].slice(width - lineLength - 1)
        // res += '\n' + ' '.repeat(firstIndent)
        lineLength = firstIndent
        wordsIndex++
      } else if (words[wordsIndex + 1]) {
        res += '\n' + ' '.repeat(secondIndent) + words[wordsIndex]
        lineLength = secondIndent
        wordsIndex++
        wrapped = true
      } else if (words[wordsIndex]) {
        res += '\n' + ' '.repeat(secondIndent) + words[wordsIndex]
        lineLength = secondIndent + words[wordsIndex].length
        wordsIndex++
      }
    }
  })

  return res
}
