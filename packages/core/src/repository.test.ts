import { describeSessionRepositoryContract } from './testing/repositoryContract.js'
import { InMemorySessionRepository } from './testing/InMemorySessionRepository.js'

/**
 * The contract, run against the in-memory double — the oracle every other
 * implementation is compared to.
 *
 * The assertions themselves live in `testing/repositoryContract.ts` so the
 * localStorage adapter (phase 4A) and the Firestore adapter (phase 5) can be
 * run against *the same suite*. One contract, many implementations: that is
 * what makes "the adapter satisfies the contract" a fact rather than a hope.
 */
describeSessionRepositoryContract(
  'InMemorySessionRepository',
  () => new InMemorySessionRepository(),
)
