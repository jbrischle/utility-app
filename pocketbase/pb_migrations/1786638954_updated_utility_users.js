/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1169277387")

  // update collection data
  unmarshal({
    "authToken": {
      "duration": 7776000
    }
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1169277387")

  // update collection data
  unmarshal({
    "authToken": {
      "duration": 432000
    }
  }, collection)

  return app.save(collection)
})
