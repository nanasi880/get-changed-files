import * as core from '@actions/core'
import { runAsync } from './main'

runAsync().catch(error => {
  if (error instanceof Error) {
    core.setFailed(error)
  } else {
    core.setFailed(String(error))
  }
})
