// Copyright 2026 The PDFium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef PUBLIC_FPDF_RAW_H_
#define PUBLIC_FPDF_RAW_H_

#include <stddef.h>
#include <stdint.h>

#include "fpdfview.h"

#ifdef __cplusplus
extern "C" {
#endif

// An owning handle to a PDF object. Close every non-null handle returned by
// this API with FPDFRaw_CloseObject(). Reference objects do not retain their
// target document, so the FPDF_DOCUMENT must outlive all handles made from it.
typedef struct FPDF_RAW_OBJECT__* FPDF_RAW_OBJECT;

// Document and cross-reference access.
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_GetRoot(FPDF_DOCUMENT document);
FPDF_EXPORT uint32_t FPDF_CALLCONV
FPDFRaw_GetLastObjectNumber(FPDF_DOCUMENT document);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_GetIndirectObject(FPDF_DOCUMENT document, uint32_t object_number);
FPDF_EXPORT uint32_t FPDF_CALLCONV
FPDFRaw_AddIndirectObject(FPDF_DOCUMENT document, FPDF_RAW_OBJECT object);
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV
FPDFRaw_DeleteIndirectObject(FPDF_DOCUMENT document, uint32_t object_number);

// Object lifetime, inspection, and creation.
FPDF_EXPORT void FPDF_CALLCONV FPDFRaw_CloseObject(FPDF_RAW_OBJECT object);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_CloneObject(FPDF_RAW_OBJECT object);
FPDF_EXPORT FPDF_OBJECT_TYPE FPDF_CALLCONV
FPDFRaw_GetObjectType(FPDF_RAW_OBJECT object);
FPDF_EXPORT uint32_t FPDF_CALLCONV
FPDFRaw_GetObjectNumber(FPDF_RAW_OBJECT object);
FPDF_EXPORT uint32_t FPDF_CALLCONV
FPDFRaw_GetGenerationNumber(FPDF_RAW_OBJECT object);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_GetDirectObject(FPDF_RAW_OBJECT object);

FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV FPDFRaw_NewNull(void);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV FPDFRaw_NewBoolean(FPDF_BOOL value);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV FPDFRaw_NewInteger(int value);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV FPDFRaw_NewNumber(float value);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_NewString(const void* data, size_t length);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_NewName(const char* data, size_t length);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV FPDFRaw_NewArray(void);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV FPDFRaw_NewDictionary(void);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_NewStream(const void* data, size_t length);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_NewReference(FPDF_DOCUMENT document, uint32_t object_number);

FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV
FPDFRaw_GetBoolean(FPDF_RAW_OBJECT object);
FPDF_EXPORT int FPDF_CALLCONV FPDFRaw_GetInteger(FPDF_RAW_OBJECT object);
FPDF_EXPORT float FPDF_CALLCONV FPDFRaw_GetNumber(FPDF_RAW_OBJECT object);
// Returns the byte count required. Copies only when buffer_length is large
// enough; no trailing NUL is included.
FPDF_EXPORT size_t FPDF_CALLCONV
FPDFRaw_GetString(FPDF_RAW_OBJECT object, void* buffer, size_t buffer_length);
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV
FPDFRaw_SetString(FPDF_RAW_OBJECT object, const void* data, size_t length);
FPDF_EXPORT uint32_t FPDF_CALLCONV
FPDFRaw_GetReferenceObjectNumber(FPDF_RAW_OBJECT object);

// Dictionary access. Keys are byte strings and need not be NUL-terminated.
FPDF_EXPORT size_t FPDF_CALLCONV
FPDFRaw_DictionaryGetCount(FPDF_RAW_OBJECT dictionary);
FPDF_EXPORT size_t FPDF_CALLCONV FPDFRaw_DictionaryGetKey(
    FPDF_RAW_OBJECT dictionary,
    size_t index,
    void* buffer,
    size_t buffer_length);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV FPDFRaw_DictionaryGet(
    FPDF_RAW_OBJECT dictionary,
    const char* key,
    size_t key_length);
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV FPDFRaw_DictionarySet(
    FPDF_RAW_OBJECT dictionary,
    const char* key,
    size_t key_length,
    FPDF_RAW_OBJECT value);
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV FPDFRaw_DictionaryRemove(
    FPDF_RAW_OBJECT dictionary,
    const char* key,
    size_t key_length);

// Array access.
FPDF_EXPORT size_t FPDF_CALLCONV
FPDFRaw_ArrayGetCount(FPDF_RAW_OBJECT array);
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_ArrayGet(FPDF_RAW_OBJECT array, size_t index);
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV
FPDFRaw_ArrayAppend(FPDF_RAW_OBJECT array, FPDF_RAW_OBJECT value);
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV
FPDFRaw_ArraySet(FPDF_RAW_OBJECT array, size_t index, FPDF_RAW_OBJECT value);
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV
FPDFRaw_ArrayRemove(FPDF_RAW_OBJECT array, size_t index);

// Stream access. GetData() decodes filters; GetRawData() does not. SetData()
// stores unfiltered bytes and removes /Filter and /DecodeParms.
FPDF_EXPORT FPDF_RAW_OBJECT FPDF_CALLCONV
FPDFRaw_StreamGetDictionary(FPDF_RAW_OBJECT stream);
FPDF_EXPORT size_t FPDF_CALLCONV FPDFRaw_StreamGetData(
    FPDF_RAW_OBJECT stream,
    void* buffer,
    size_t buffer_length);
FPDF_EXPORT size_t FPDF_CALLCONV FPDFRaw_StreamGetRawData(
    FPDF_RAW_OBJECT stream,
    void* buffer,
    size_t buffer_length);
FPDF_EXPORT FPDF_BOOL FPDF_CALLCONV FPDFRaw_StreamSetData(
    FPDF_RAW_OBJECT stream,
    const void* data,
    size_t length);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // PUBLIC_FPDF_RAW_H_
