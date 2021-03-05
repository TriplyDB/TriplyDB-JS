FROM triply/ci14:20210118
MAINTAINER info@triply.cc


#Use this as first arg. That way we force the image to build
ARG CI_PIPELINE_ID
ARG NPM_TOKEN

# Separate stage, so we dont install everything on every commit
COPY ./package.json ./yarn.lock /deps/
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> /.npmrc
RUN cd /deps && ln -s ../.npmrc && yarn ;



COPY . /triplydb-js
# do a link. Moving it will be slow, because docker has to create a new build stage
RUN ln -s /deps/node_modules /triplydb-js/node_modules;
RUN cd /triplydb-js && ln -s ../.npmrc && yarn run build;

# Create `.tgz` package of the repo. This takes into account the npmignore file. This is used internally by yarn when publishing
RUN cd /triplydb-js \
    && yarn pack \
    && tar -xzf triply-triplydb-*.tgz \
    && rm triply-triplydb-*.tgz \
    && mv package /triplydb-js-packed \
    && cp -r node_modules /triplydb-js-packed
