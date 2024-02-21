// Remove all locally written types and use the types from utils models once utils version is upgraded
type Empty = {
  [key: string | number | symbol]: never;
};

export type QueryJobCreate = {
  queryId: string;
  queryVersion?: number;
  sourceDatasetId: string;
  targetDatasetId: string;
  targetGraphName?: string;
};

export type QueryJobStatus = "pending" | "running" | "resultsReady" | "servingResults" | "finished" | "error";
export type QueryJobs = Array<QueryJobModel>;
export type QueryJobModel = {
  id: string;
  status: QueryJobStatus;
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
};

export namespace Routes_queryJobs {
  export namespace _account {
    interface Params {
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
    export interface Post {
      Req: {
        Query: Empty;
        Params: Params;
        Body: QueryJobCreate;
      };
      Res: {
        Body: any;
      };
    }
    export namespace _queryJob {
      interface Params {
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
          Body: QueryJobModel;
        };
      }
      export interface Delete {
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
