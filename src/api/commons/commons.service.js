export default function ({ commercetools, entity }) {
  const ctClient = commercetools.client;
  const ctRequestBuilder = commercetools.requestBuilder;

  function updateEntity({ id, version, actions }) {
    return ctClient.execute({
      uri: ctRequestBuilder[entity].parse({ id }).build(),
      method: 'POST',
      body: { version, actions },
    });
  }

  return {
    byId(id) {
      return ctClient
        .execute({
          uri: ctRequestBuilder[entity].parse({ id }).build(),
          method: 'GET',
        })
        .then(res => res.body);
    },

    save(params) {
      return ctClient
        .execute({
          uri: ctRequestBuilder[entity].build(),
          method: 'POST',
          body: params,
        })
        .then(res => res.body);
    },

    update({ id, version, actions }) {
      return Promise.resolve()
        .then(() => {
          if (version) {
            return updateEntity({ id, version, actions });
          }
          return this.byId(id).then(instance =>
            updateEntity({ id, version: instance.version, actions }),
          );
        })
        .then(res => res.body);
    },

    find({ where, page, perPage, sortBy, sortAscending, expand }) {
      let requestBuilder = ctRequestBuilder[entity];

      requestBuilder = where ? requestBuilder.where(where) : requestBuilder;
      requestBuilder = sortBy ? requestBuilder.sort(sortBy, sortAscending) : requestBuilder;
      requestBuilder = page ? requestBuilder.page(page) : requestBuilder;
      requestBuilder = perPage ? requestBuilder.perPage(perPage) : requestBuilder;
      requestBuilder = expand ? requestBuilder.expand(expand) : requestBuilder;

      return ctClient
        .execute({
          uri: requestBuilder.build(),
          method: 'GET',
        })
        .then(res => ({ results: res.body.results, total: res.body.total }));
    },
  };
}
