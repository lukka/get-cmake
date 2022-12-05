#!/bin/bash
CMAKE_VER="1.10.0"
REQ="~1.10.0"
        case ${REQ} in
          'latest')
            EXPECTED_CMAKE_VER=`cat .latest_cmake_version`
            ;;
          'latestrc')
            EXPECTED_CMAKE_VER=`cat .latestrc_cmake_version`
            ;;
          \~*)
            # Drop initial ~
            REQ=${REQ:1}
            # Drop ".patch"
            EXPECTED_CMAKE_VER="${REQ%.*}"
            ;;
          \^*)
            # Drop initial ^
            REQ=${REQ:1}
            # Drop ".minor.patch"
            EXPECTED_CMAKE_VER="${REQ%.*.*}"
            ;;
          *)
            # Use it as is.
            EXPECTED_CMAKE_VER="${REQ}"
            ;;
        esac
        if ! [[ "$CMAKE_VER" =~ .*${EXPECTED_CMAKE_VER}.* ]]; then
          echo "ASSERTION FAILED! Instead of '${EXPECTED_CMAKE_VER}', found: "
          echo "$CMAKE_VER"
          exit -1
        fi
        echo $EXPECTED_CMAKE_VER
