import { DatasetCore, Quad, Term } from "@rdfjs/types";
import * as n3 from "n3";
import Dataset, { Pattern } from "./Dataset";
import { makeSync } from "./utils/busyWait";

export const emptyDataset: DatasetCore<n3.Quad> = {
  size: 0,

  /**
   * Adds the specified quad to the dataset.
   *
   * Existing quads, as defined in `Quad.equals`, will be ignored.
   */
  add: function () {
    throw new Error("TriplyRdfJSDataset is not writeable.");
  },

  /**
   * Removes the specified quad from the dataset.
   */
  delete: function () {
    throw new Error("TriplyRdfJSDataset is not writeable.");
  },

  /**
   * Determines whether a dataset includes a certain quad.
   */
  has: function () {
    return false;
  },

  /**
   * Returns a new dataset that is comprised of all quads in the current instance matching the given arguments.
   *
   * The logic described in {@link https://rdf.js.org/dataset-spec/#quad-matching|Quad Matching} is applied for each
   * quad in this dataset to check if it should be included in the output dataset.
   *
   * This method always returns a new DatasetCore, even if that dataset contains no quads.
   *
   * Since a `DatasetCore` is an unordered set, the order of the quads within the returned sequence is arbitrary.
   *
   * @param subject   The optional exact subject to match.
   * @param predicate The optional exact predicate to match.
   * @param object    The optional exact object to match.
   * @param graph     The optional exact graph to match.
   */
  match: function () {
    return emptyDataset;
  },

  [Symbol.iterator]: function () {
    return {
      // NOTE: 'next' is defined using a tuple to ensure we report the correct assignability errors in all places.
      next: function () {
        return {
          done: true,
          value: undefined,
        };
      },
    };
  },
};

export class TriplyRdfJSDataset implements DatasetCore<n3.Quad> {
  protected dataset: Dataset;
  protected pattern: Pattern;
  readonly size = 5_000_000; // some random big number

  constructor(dataset: Dataset, pattern?: Pattern) {
    this.dataset = dataset;
    this.pattern = pattern ?? {};
  }

  /**
   * Adds the specified quad to the dataset.
   *
   * Existing quads, as defined in `Quad.equals`, will be ignored.
   */
  add(): this {
    throw new Error("TriplyRdfJSDataset is not writeable.");
  }

  /**
   * Removes the specified quad from the dataset.
   */
  delete(): this {
    throw new Error("TriplyRdfJSDataset is not writeable.");
  }

  /**
   * Determines whether a dataset includes a certain quad.
   */
  has(quad: Quad): boolean {
    const matches = this.match(quad.subject, quad.predicate, quad.object, quad.graph);
    for (const _ of matches) {
      return true;
    }
    return false;
  }

  /**
   * Returns a new dataset that is comprised of all quads in the current instance matching the given arguments.
   *
   * The logic described in {@link https://rdf.js.org/dataset-spec/#quad-matching|Quad Matching} is applied for each
   * quad in this dataset to check if it should be included in the output dataset.
   *
   * This method always returns a new DatasetCore, even if that dataset contains no quads.
   *
   * Since a `DatasetCore` is an unordered set, the order of the quads within the returned sequence is arbitrary.
   *
   * @param subject   The optional exact subject to match.
   * @param predicate The optional exact predicate to match.
   * @param object    The optional exact object to match.
   * @param graph     The optional exact graph to match.
   */
  match(
    subject?: Term | null,
    predicate?: Term | null,
    object?: Term | null,
    graph?: Term | null
  ): DatasetCore<n3.Quad> {
    const matchPattern = { subject, predicate, object, graph };
    const newPattern: Pattern = {};
    for (const pos of ["subject", "predicate", "object", "graph"] as const) {
      if (matchPattern[pos] !== null && this.pattern[pos] !== undefined && matchPattern[pos] !== this.pattern[pos])
        return emptyDataset;
      newPattern[pos] = matchPattern[pos] ?? this.pattern[pos];
    }
    return new TriplyRdfJSDataset(this.dataset, newPattern);
  }

  [Symbol.iterator](): Iterator<n3.Quad> {
    return makeSync(this.dataset.statements(this.pattern)[Symbol.asyncIterator]());
  }
}
