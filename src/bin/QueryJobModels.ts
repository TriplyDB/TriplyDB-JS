// Remove all locally written types and use the types from utils models once utils version is upgraded
type Empty = {
  [key: string | number | symbol]: never;
};

export type QueryJobStatus =
  | "pending"
  | "running"
  | "resultsReady"
  | "servingResults"
  | "finished"
  | "error"
  | "cancelled";
export type PipelineStatus = "pending" | "running" | "importing" | "finished" | "error" | "cancelled";
export type QueryJobs = Array<QueryJob>;
export type QueryJob = {
  id: string;
  status: QueryJobStatus;
  pipelineId: string;
  pipelineStatus: PipelineStatus;
  ownerName: string;
  queryName: string;
  queryOwner: string;
  queryVersion: number;
  sourceDatasetName: string;
  sourceDatasetOwner: string;
  targetDatasetName: string;
  targetDatasetOwner: string;
  queryString: string;
  startTime?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  progress: number;
  errorMessage?: string;
  processingTimeMs?: number;
  numberOfStatements?: number;
};

export type QueryJobPipeline = {
  pipelineId: string;
  progress: number;
  pipelineStatus: PipelineStatus;
  pipelineError?: any;
  queries: Array<Pick<QueryJob, "ownerName" | "queryName" | "status" | "progress">>;
};

export type QueryJobPipelineCreate = QueryJobPipelineConfigV01;

export interface QueryJobPipelineConfigV01 {
  queries: Array<{ queryName: `${string}/${string}` /* {owner}/{query} */; queryVersion?: number; priority?: number }>;
  sourceDataset: `${string}/${string}`; // {owner}/{dataset}
  targetDataset: `${string}/${string}`; // {owner}/{dataset}
  targetGraphName?: string;
  version: "0.1";
}

export namespace Routes_queryJobs {
  export namespace _account {
    export interface Params {
      account: string;
    }
    export interface Get {
      Req: {
        Query: Empty;
        Params: Params;
        Body: Empty;
      };
      Res: {
        Body: QueryJobs;
      };
    }

    export namespace pipeline {
      export interface Post {
        Req: {
          Query: Empty;
          Params: Params;
          Body: QueryJobPipelineCreate;
        };
        Res: {
          Body: QueryJob;
        };
      }
      export namespace _pipeline {
        export interface Params extends Routes_queryJobs._account.Params {
          pipeline: string;
        }
        export interface Get {
          Req: {
            Query: Empty;
            Params: Params;
            Body: Empty;
          };
          Res: {
            Body: QueryJobPipeline;
          };
        }
      }
    }

    export namespace _queryJob {
      export interface Params {
        account: string;
        queryJob: string;
      }

      export interface Get {
        Req: {
          Query: Empty;
          Params: Params;
          Body: Empty;
        };
        Res: {
          Body: QueryJob;
        };
      }
      export namespace cancel {
        export interface Post {
          Req: {
            Query: Empty;
            Params: Params;
            Body: Empty;
          };
          Res: {
            Body: Empty;
          };
        }
      }
    }
  }
}
