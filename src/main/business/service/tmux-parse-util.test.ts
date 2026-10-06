import { expect, test } from 'vitest'

import { tmuxParseUtil } from '#src/main/business/service/tmux-parse-util'

test('parseClientOutput maps tty, session and activity fields in tmux output order', () => {
  const result = tmuxParseUtil.parseClientOutput({
    stderr: '',
    stdout: '/dev/ttys001\ts01-a3f9c2\t1700000099\n/dev/ttys002\twork\t1700000050\n',
  })

  expect(result).toEqual([
    { activity: 1700000099, session: 's01-a3f9c2', tty: '/dev/ttys001' },
    { activity: 1700000050, session: 'work', tty: '/dev/ttys002' },
  ])
})
