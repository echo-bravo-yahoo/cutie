function wrap(text, indent = 0, width = 32) {
  const lines = text.split('\n')
  // use the first lines' indent as a baseline
  // const indent = lines[0].match(/^\s{0,2}/)[0].length
  // have we linewrapped yet?
  let wrapped = false
  let res = ''

  lines.forEach((line) => {
    const words = line.split(' ')
    let wordsIndex = 0
    let lineLength = indent

    for(let i = 0; i < words.length; i++) {
      // while we have space for the current line, a space, and the next word...
      while (words[wordsIndex] && width - lineLength - words[wordsIndex].length > 1) {
        res += ' ' + words[wordsIndex]
        lineLength += words[wordsIndex].length
        wordsIndex++
      }

      // if the word is too big to fit on even a blank line,
      if (words[wordsIndex] && words[wordsIndex].length > width - indent) {
        console.log('if', words[wordsIndex], width, indent)
        res += ' ' + words[wordsIndex].slice(0, width - lineLength - 1)
        // bug: words twice (or more) the width won't wrap correctly
        res += '\n' + ' '.repeat(indent) + words[wordsIndex].slice(width - lineLength - 1)
        lineLength = indent
      } else if (words[wordsIndex + 1] && words[wordsIndex + 1].length > width - indent) {
        console.log('else', words[wordsIndex], width, indent)
        res += '\n' + ' '.repeat(indent) + words[wordsIndex + 2].slice(width - lineLength - 1)
        // res += '\n' + ' '.repeat(indent)
        lineLength = indent
      } else if (words[wordsIndex + 1]) {
        console.log('duh')
        res += '\n' + ' '.repeat(indent)
        lineLength = indent
      }
    }
  })

  return res
}

exports = module.exports = {
  wrap
}
