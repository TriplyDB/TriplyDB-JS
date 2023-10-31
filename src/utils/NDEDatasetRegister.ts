import n3 from "n3";
import Dataset from "../Dataset.js";
import { getErr } from "./Error.js";

const response2store = async (rs: Response): Promise<n3.Store> => {
  try {
    return new n3.Store(new n3.Parser().parse(await rs.text()));
  } catch (e) {
    throw getErr("Failed to parse NDE Dataset Register response as valid RDF. Please contact NDE about this issue.");
  }
};

export default async function NDEDatasetRegister(
  dataset: Dataset,
  method: "validate" | "submit",
  rejectOnValidationError?: boolean
): Promise<n3.Store> {
  const info = await dataset.getInfo();
  if (info.accessLevel !== "public") {
    return Promise.reject(
      getErr(
        `Only datasets with accesslevel 'public' can be submitted your dataset has accesslevel '${info.accessLevel}'.`
      )
    );
  }
  const { consoleUrl } = await dataset["_app"].getInfo();
  const datasetURL = `${consoleUrl}/${info.owner.accountName}/${info.name}`;
  const apiUrl =
    "https://datasetregister.netwerkdigitaalerfgoed.nl/api/datasets" + (method === "validate" ? "/validate" : "");
  const data = { "@id": datasetURL };
  const init: RequestInit = {
    method: method === "submit" ? "POST" : "PUT",
    headers: {
      "Content-Type": "application/ld+json",
      Accept: "text/turtle",
      Link: '<http://www.w3.org/ns/ldp#RDFSource>; rel="type",<http://www.w3.org/ns/ldp#Resource>; rel="type"',
    },
    body: JSON.stringify(data),
  };

  let rs: Response;
  try {
    rs = await fetch(apiUrl, init);
  } catch (e) {
    throw getErr(`Could not connect to the NDE Dataset Register at ${apiUrl}.`);
  }

  if (rs.ok) {
    return response2store(rs);
  } else if (rs.status === 400) {
    //this is a SHACL validation, we either throw or return the report (Store)
    if (rejectOnValidationError ?? true) {
      throw getErr(
        `NDE Dataset Register reported: could not ${method} dataset '${info.displayName}' because of a SHACL validation error.\nPlease use their validation tool to see what might be wrong:\nhttps://datasetregister.netwerkdigitaalerfgoed.nl/validate.php?url=${datasetURL}`
      );
    } else {
      return response2store(rs);
    }
  } else if (rs.status === 404) {
    throw getErr(`NDE Dataset Register reported that the Dataset URL '${datasetURL}' can not be found.`);
  } else {
    //this not a SHACL validation error, but something else, point the user to their validation tool and throw
    throw getErr(
      `Could not ${method} dataset '${info.displayName}'.\nNDE Dataset Register reported: '${rs.statusText}' (code ${rs.status}).\nPlease use their validation tool to see what might be wrong:\nhttps://datasetregister.netwerkdigitaalerfgoed.nl/validate.php?url=${datasetURL}`
    );
  }
}
