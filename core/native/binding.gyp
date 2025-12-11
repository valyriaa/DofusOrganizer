{
  "targets": [
    {
      "target_name": "process_watcher",
      "sources": [ "process_watcher.cpp" ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_CPP_EXCEPTIONS" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "cflags!": [ "-fno-exceptions" ]
    }
  ]
}
