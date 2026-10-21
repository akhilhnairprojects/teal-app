# Third-party notices

## MBTA Go (mbta/mobile_app)

Teal ports business logic (departure formatting, upcoming-trip joins, route-card grouping and
sorting, direction labels, alert significance and matching, route pills, nearby-stop selection,
occupancy mapping) and the matching unit-test cases from MBTA Go's shared Kotlin module to
TypeScript.

- Source: https://github.com/mbta/mobile_app
- Commit: `8c49ac5`
- Paths: `shared/src/commonMain/kotlin/com/mbta/tid/mbta_app/` and `shared/src/commonTest/kotlin/com/mbta/tid/mbta_app/`
- Ported files carry a header comment naming the original file.

No MBTA Go assets, strings files, map styles, backend hosts, credentials, logos or trademarks are
included. Teal is not affiliated with or endorsed by the MBTA.

```
MIT License

Copyright (c) 2023 Massachusetts Bay Transportation Authority

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
