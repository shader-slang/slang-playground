#if defined(TRY_SLANG_COMPILER_MSVC)

// 'bytes' bytes padding added after construct 'member_name'
#pragma warning(disable : 4820)

// class has virtual functions, but its trivial destructor is not virtual
#pragma warning(disable : 5204)

#pragma warning(push, 3)

#endif // defined(TRY_SLANG_COMPILER_MSVC)
