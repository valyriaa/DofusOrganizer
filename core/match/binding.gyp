{
  "targets": [
    {
      "target_name": "matcher",
      "sources": ["matcher.cpp"],
      "include_dirs": [
        "<!(node -p \"require('./ocv.js')()[0] + '/build/include'\")",
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags_cc": ["-std=c++17"],
      "conditions": [
        ["OS=='linux' or OS=='mac'", {
          "link_settings": { "libraries": ["-lopencv_core", "-lopencv_imgproc", "-lopencv_imgcodecs"] },
          "xcode_settings": { "OTHER_CPLUSPLUSFLAGS": ["-stdlib=libc++"] }
        }],
        ["OS=='win'", {
          "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] } }
        }]
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS=0"],
       "libraries": [
        "<!(node -p \"require('./ocv.js')()[0] + '/build/x64/vc16/lib/opencv_world4110.lib' \")"
      ]
    }
  ]
}
